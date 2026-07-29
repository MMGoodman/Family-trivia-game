import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import * as api from '../lib/api'
import { computeScores, withRanks, correctAnswerOf } from '../lib/scoring'

const LETTERS = ['א', 'ב', 'ג', 'ד']

// מסך ההקרנה: פונטים ענקיים, בלי לחשוף הצבעות לפני הזמן.
// מאזין לשינויים ב-Supabase Realtime ומתרענן מיד.
export default function DisplayScreen() {
  const { gameId } = useParams()
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const prevScores = useRef(new Map())
  const [gains, setGains] = useState(new Map())
  const [timerEnd, setTimerEnd] = useState(null)

  const reload = useCallback(async () => {
    try {
      const full = await api.loadFullGame(gameId)
      setState(full)
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [gameId])

  useEffect(() => {
    // מציגים מיד את העותק המקומי, ומתרעננים מהשרת ברקע
    const cached = api.readCachedGame(gameId)
    if (cached) setState((s) => s ?? cached)
    reload()

    const channel = supabase
      .channel(`display-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'votes' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, reload)
      .subscribe()

    // שעון: המנחה משדר בערוץ נפרד
    const timerChannel = supabase
      .channel(`game-${gameId}`)
      .on('broadcast', { event: 'timer' }, ({ payload }) => setTimerEnd(payload.endsAt))
      .subscribe()

    // רשת ביטחון: ריענון כל 5 שניות גם אם אירוע חי הלך לאיבוד
    const interval = setInterval(reload, 5000)

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(timerChannel)
      clearInterval(interval)
    }
  }, [gameId, reload])

  // אנימציית "+3" כשקבוצה מקבלת נקודות
  useEffect(() => {
    if (!state) return
    const board = computeScores(state.groups, state.questions, state.votes)
    const newGains = new Map()
    for (const g of board) {
      const prev = prevScores.current.get(g.id)
      if (prev !== undefined && g.score > prev) newGains.set(g.id, g.score - prev)
      prevScores.current.set(g.id, g.score)
    }
    if (newGains.size) {
      setGains(newGains)
      const t = setTimeout(() => setGains(new Map()), 2500)
      return () => clearTimeout(t)
    }
  }, [state])

  if (error) return <div className="center-screen banner">{error}</div>
  if (!state) return <div className="center-screen muted">מתחבר…</div>

  const { game, groups, questions, votes } = state
  const current = questions.find((q) => q.id === game.current_question_id) || null
  const currentIdx = current ? questions.findIndex((q) => q.id === current.id) : -1
  const revealed = game.phase === 'revealed'
  const finished = game.phase === 'finished'
  const correct = current ? correctAnswerOf(current) : null

  const currentVotes = current ? votes.filter((v) => v.question_id === current.id) : []
  const board = withRanks(computeScores(groups, questions, votes))

  return (
    <div className="display">
      {timerEnd && !revealed && !finished && current && <TimerBubble endsAt={timerEnd} />}
      <div className="display-main">
        {finished ? (
          <FinalBoard board={board} gameName={game.name} />
        ) : !current ? (
          <div className="col" style={{ alignItems: 'center', gap: '1.5rem' }}>
            <h1 className="display-q" style={{ textAlign: 'center' }}>
              {game.name}
            </h1>
            <div className="muted" style={{ fontSize: '1.5rem' }}>
              המשחק יתחיל בקרוב…
            </div>
          </div>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted" style={{ fontSize: '1.2rem' }}>
                שאלה {currentIdx + 1} / {questions.length}
              </span>
              <span className="weight-badge">שווה {current.weight} נק'</span>
            </div>

            {current.text && <h1 className="display-q">{current.text}</h1>}
            {current.image_path && (
              <img className="display-img" src={api.imageUrl(current.image_path)} alt="" />
            )}

            <div className="display-answers">
              {current.answers.map((a, i) => {
                const cls = revealed
                  ? a.is_correct
                    ? 'display-answer correct'
                    : 'display-answer dimmed'
                  : 'display-answer'
                return (
                  <div className={cls} key={a.id}>
                    <span className="letter">{LETTERS[i]}</span>
                    <span>{a.text}</span>
                  </div>
                )
              })}
            </div>

            {revealed && correct ? (
              <RevealLine votes={currentVotes} groups={groups} correct={correct} weight={current.weight} />
            ) : (
              <div className="row" style={{ gap: '1rem', alignItems: 'center' }}>
                <div className="progress" style={{ flex: 1, height: 10 }}>
                  <div
                    style={{
                      width: `${groups.length ? (currentVotes.length / groups.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span style={{ fontSize: '1.3rem', whiteSpace: 'nowrap' }}>
                  ענו {currentVotes.length} מתוך {groups.length}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <div className="display-side">
        <h2 style={{ margin: 0 }}>🏆 לוח ניקוד</h2>
        {board.map((g) => (
          <div className={`display-board-row ${g.rank === 1 && g.score > 0 ? 'leader' : ''}`} key={g.id}>
            <span className="board-rank">{medal(g.rank)}</span>
            <span className="display-name entry-name">{g.name}</span>
            <span className="display-score">
              {gains.has(g.id) && <span className="gain">+{gains.get(g.id)} </span>}
              {g.score}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// השעון הגדול שהקהל רואה: ספירה לאחור, מאדים ופועם ב-5 השניות האחרונות
function TimerBubble({ endsAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [])
  const remaining = Math.ceil((endsAt - now) / 1000)
  if (remaining < -3) return null // "הזמן נגמר" נעלם לבד אחרי שלוש שניות
  const over = remaining <= 0
  return (
    <div className={`timer-bubble ${over ? 'over' : remaining <= 5 ? 'urgent' : ''}`}>
      {over ? 'הזמן נגמר!' : remaining}
    </div>
  )
}

function medal(rank) {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank
}

function RevealLine({ votes, groups, correct, weight }) {
  const winners = groups.filter((g) =>
    votes.some((v) => v.group_id === g.id && v.answer_id === correct.id),
  )
  return (
    <div style={{ fontSize: 'clamp(1.2rem, 2vw, 2rem)', textAlign: 'center' }}>
      {winners.length === 0 ? (
        <span>😅 אף קבוצה לא צדקה הפעם!</span>
      ) : (
        <span>
          🎉 צדקו: <b style={{ color: 'var(--good)' }}>{winners.map((g) => g.name).join(' · ')}</b>{' '}
          <span className="gain">+{weight}</span>
        </span>
      )}
    </div>
  )
}

function FinalBoard({ board, gameName }) {
  return (
    <div className="col" style={{ alignItems: 'center', gap: '2rem' }}>
      <h1 className="display-q" style={{ textAlign: 'center' }}>
        🏆 {gameName} — תוצאות
      </h1>
      <div className="col" style={{ gap: '1rem', width: 'min(600px, 100%)' }}>
        {board.map((g) => (
          <div
            className="display-answer"
            key={g.id}
            style={g.rank === 1 ? { borderColor: 'var(--accent)', background: '#2b230d' } : undefined}
          >
            <span className="letter">{medal(g.rank)}</span>
            <span style={{ flex: 1 }}>{g.name}</span>
            <b style={{ fontVariantNumeric: 'tabular-nums' }}>{g.score}</b>
          </div>
        ))}
      </div>
    </div>
  )
}
