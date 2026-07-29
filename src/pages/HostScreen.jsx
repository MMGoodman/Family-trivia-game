import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import * as api from '../lib/api'
import { computeScores, withRanks, correctAnswerOf } from '../lib/scoring'
import { confirmDialog, promptDialog } from '../components/dialog'

const LETTERS = ['א', 'ב', 'ג', 'ד']

export default function HostScreen() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [timerEnd, setTimerEnd] = useState(null)
  const channelRef = useRef(null)

  // תור שמירות: כל הכתיבות לשרת רצות אחת אחרי השנייה, בסדר הלחיצות.
  // בלי זה, שתי בקשות במקביל יכולות לנחות בסדר הפוך ולדרוס אחת את השנייה
  // (למשל: איפוס משחק שרץ לפני רישום תשובה שעוד היה באוויר).
  const writeQueue = useRef(Promise.resolve())
  function enqueue(fn) {
    const p = writeQueue.current.then(fn)
    writeQueue.current = p.catch(() => {}) // שגיאה לא תוקעת את התור
    p.catch(syncFail)
    return p
  }

  // ערוץ שידור לשעון — מסך ההקרנה מאזין לו
  useEffect(() => {
    const ch = supabase.channel(`game-${gameId}`)
    ch.subscribe()
    channelRef.current = ch
    return () => {
      supabase.removeChannel(ch)
      channelRef.current = null
    }
  }, [gameId])

  const reload = useCallback(async () => {
    try {
      const full = await api.loadFullGame(gameId)
      setState(full)
      setError('')
      return full
    } catch (e) {
      setError(e.message)
    }
  }, [gameId])

  useEffect(() => {
    // מציגים מיד את העותק המקומי, ומתרעננים מהשרת ברקע
    const cached = api.readCachedGame(gameId)
    if (cached) setState((s) => s ?? cached)
    reload()
  }, [gameId, reload])

  if (error) return <div className="app banner">{error}</div>
  if (!state) return <div className="center-screen muted">טוען…</div>

  const { game, groups, questions, votes } = state
  const current = questions.find((q) => q.id === game.current_question_id) || null
  const currentIdx = current ? questions.findIndex((q) => q.id === current.id) : -1
  const phase = game.phase

  const currentVotes = current ? votes.filter((v) => v.question_id === current.id) : []
  const votedGroups = new Set(currentVotes.map((v) => v.group_id))
  const allVoted = groups.length > 0 && votedGroups.size === groups.length
  const correct = current ? correctAnswerOf(current) : null

  const board = withRanks(computeScores(groups, questions, votes))

  // כל הפעולות "אופטימיות": המסך מתעדכן מיד, השמירה רצה ברקע.
  // אם שמירה נכשלת — מוצגת שגיאה והמצב מסתנכרן מחדש מהשרת.
  function syncFail(e) {
    setError('שגיאה בשמירה: ' + e.message)
    reload()
  }

  function setPhase(patch) {
    setState((s) => ({ ...s, game: { ...s.game, ...patch } }))
    enqueue(() => api.updateGame(gameId, patch))
  }

  // ---------- שעון ----------

  function sendTimer(endsAt) {
    setTimerEnd(endsAt)
    channelRef.current?.send({ type: 'broadcast', event: 'timer', payload: { endsAt } })
  }

  function startTimer(seconds) {
    sendTimer(Date.now() + seconds * 1000)
  }

  function stopTimer() {
    if (timerEnd) sendTimer(null)
  }

  function goToQuestion(idx) {
    if (idx < 0 || idx >= questions.length) return
    stopTimer()
    setPhase({ current_question_id: questions[idx].id, phase: 'question' })
  }

  function startGame() {
    goToQuestion(0)
  }

  function reveal() {
    stopTimer()
    setPhase({ phase: 'revealed' })
  }

  async function restartGame() {
    const ok = await confirmDialog({
      title: '🔄 להתחיל את המשחק מהתחלה?',
      message:
        'כל התשובות שנרשמו וההתאמות הידניות של הניקוד יימחקו.\nהשאלות והקבוצות יישארו כמו שהן.',
      confirmText: 'כן, התחל מחדש',
      danger: true,
    })
    if (!ok) return
    stopTimer()
    try {
      // נכנס לתור — מחכה שכל שמירה קודמת תסתיים לפני שמוחקים
      await enqueue(() => api.resetGame(gameId, questions.map((q) => q.id)))
      await reload()
    } catch {
      /* השגיאה כבר טופלה בתור */
    }
  }

  async function next() {
    if (currentIdx + 1 < questions.length) {
      await goToQuestion(currentIdx + 1)
    } else {
      await setPhase({ phase: 'finished' })
    }
  }

  function vote(group, answer) {
    // לחיצה חוזרת על אותה תשובה מבטלת את הרישום
    const existing = currentVotes.find((v) => v.group_id === group.id)
    const qid = current.id
    if (existing && existing.answer_id === answer.id) {
      setState((s) => ({
        ...s,
        votes: s.votes.filter((v) => !(v.question_id === qid && v.group_id === group.id)),
      }))
      enqueue(() => api.clearVote(qid, group.id))
    } else {
      setState((s) => ({
        ...s,
        votes: [
          ...s.votes.filter((v) => !(v.question_id === qid && v.group_id === group.id)),
          { id: `tmp-${qid}-${group.id}`, question_id: qid, group_id: group.id, answer_id: answer.id },
        ],
      }))
      enqueue(() => api.castVote(qid, group.id, answer.id))
    }
  }

  async function adjustScore(group) {
    const raw = await promptDialog({
      title: `התאמת ניקוד — ${group.name}`,
      message: 'מספר שיתווסף לניקוד (אפשר שלילי, למשל ‎-2). אפס מבטל את ההתאמה.',
      defaultValue: String(group.adjustment || 0),
      inputMode: 'numeric',
      confirmText: 'עדכן ניקוד',
    })
    if (raw === null) return
    const val = parseInt(raw, 10)
    if (Number.isNaN(val)) return
    setState((s) => ({
      ...s,
      groups: s.groups.map((g) => (g.id === group.id ? { ...g, adjustment: val } : g)),
    }))
    enqueue(() => api.updateGroup(group.id, { adjustment: val }))
  }

  function openDisplay() {
    window.open(`${window.location.origin}${window.location.pathname}#/game/${gameId}/display`, '_blank')
  }

  return (
    <>
      <div className="topbar">
        <button className="ghost" onClick={() => navigate('/')}>
          ← יציאה
        </button>
        <h1>{game.name} — ניהול</h1>
        <div className="spacer" />
        <button className="ghost" onClick={() => navigate(`/game/${gameId}/edit`)}>
          עריכת המשחק
        </button>
        {(phase !== 'idle' || current) && (
          <button className="ghost danger" onClick={restartGame}>
            🔄 התחל מחדש
          </button>
        )}
        <button onClick={openDisplay}>פתח מסך הקרנה ↗</button>
      </div>

      <div className="app host">
        <div className="col" style={{ gap: '1rem' }}>
          {/* ---- מצב פתיחה ---- */}
          {(phase === 'idle' || !current) && phase !== 'finished' && (
            <div className="card col" style={{ gap: '1rem' }}>
              <h2 style={{ margin: 0 }}>מוכנים להתחיל?</h2>
              <div className="muted">
                {groups.length} קבוצות · {questions.length} שאלות
              </div>
              <div className="muted">
                טיפ: פתח קודם את מסך ההקרנה וגרור אותו למקרן/טלוויזיה, ואז לחץ התחל.
              </div>
              <button className="primary" onClick={startGame} disabled={questions.length === 0}>
                התחל את המשחק
              </button>
            </div>
          )}

          {/* ---- סיום ---- */}
          {phase === 'finished' && (
            <div className="card col" style={{ gap: '1rem' }}>
              <h2 style={{ margin: 0 }}>🏆 המשחק הסתיים!</h2>
              {board[0] && (
                <div style={{ fontSize: '1.3rem' }}>
                  המנצחים: <b style={{ color: 'var(--accent)' }}>{board[0].name}</b> עם{' '}
                  {board[0].score} נקודות
                </div>
              )}
              <div className="row">
                <button onClick={() => goToQuestion(questions.length - 1)}>חזור לשאלה האחרונה</button>
                <button className="ghost danger" onClick={restartGame}>
                  🔄 התחל מהתחלה (מחיקת התוצאות)
                </button>
              </div>
            </div>
          )}

          {/* ---- שאלה פעילה ---- */}
          {current && phase !== 'finished' && (
            <>
              <div className="card col" style={{ gap: '0.75rem' }}>
                <div className="row">
                  <span className="chip">
                    שאלה {currentIdx + 1} מתוך {questions.length}
                  </span>
                  <span className="chip">{current.weight} נק'</span>
                  {phase === 'revealed' && <span className="chip ok">נחשפה</span>}
                  <div className="spacer" />
                  <button className="ghost" onClick={() => goToQuestion(currentIdx - 1)} disabled={currentIdx === 0}>
                    → הקודמת
                  </button>
                </div>

                <div style={{ fontSize: '1.15rem', fontWeight: 600 }}>
                  {current.text || '(שאלת תמונה)'}
                </div>
                {current.image_path && (
                  <img
                    src={api.imageUrl(current.image_path)}
                    alt=""
                    style={{ maxHeight: 140, borderRadius: 10, alignSelf: 'flex-start' }}
                  />
                )}

                <div className="col" style={{ gap: '0.35rem' }}>
                  {current.answers.map((a, i) => (
                    <div className="row" key={a.id} style={{ gap: '0.5rem' }}>
                      <span
                        className="q-num"
                        style={
                          a.is_correct
                            ? { background: 'var(--good)', color: '#04150c' }
                            : undefined
                        }
                      >
                        {LETTERS[i]}
                      </span>
                      <span style={a.is_correct ? { color: 'var(--good)', fontWeight: 700 } : undefined}>
                        {a.text}
                      </span>
                    </div>
                  ))}
                  {!correct && (
                    <div className="banner">לשאלה זו לא סומנה תשובה נכונה — ערוך אותה לפני החשיפה.</div>
                  )}
                </div>
              </div>

              {/* ---- רישום הצבעות ---- */}
              <div className="card col" style={{ gap: '0.75rem' }}>
                <div className="row wrap">
                  <b>רישום תשובות</b>
                  {phase !== 'revealed' &&
                    (timerEnd ? (
                      <>
                        <HostCountdown endsAt={timerEnd} />
                        <button className="ghost" onClick={stopTimer}>
                          עצור שעון
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="ghost" onClick={() => startTimer(30)}>
                          ⏱ 30 שנ'
                        </button>
                        <button className="ghost" onClick={() => startTimer(60)}>
                          ⏱ 60 שנ'
                        </button>
                      </>
                    ))}
                  <div className="spacer" />
                  <span className={allVoted ? 'chip ok' : 'chip'}>
                    נרשמו {votedGroups.size} מתוך {groups.length}
                  </span>
                </div>
                <div className="progress">
                  <div style={{ width: `${groups.length ? (votedGroups.size / groups.length) * 100 : 0}%` }} />
                </div>

                <div className="entry-grid">
                  {groups.map((g) => {
                    const v = currentVotes.find((x) => x.group_id === g.id)
                    return (
                      <div className={`entry-row ${v ? 'done' : ''}`} key={g.id}>
                        <span className="entry-name">{g.name}</span>
                        <div className="opt-buttons">
                          {current.answers.map((a, i) => {
                            const on = v?.answer_id === a.id
                            const cls = on
                              ? phase === 'revealed'
                                ? a.is_correct
                                  ? 'on correct'
                                  : 'on wrong'
                                : 'on'
                              : ''
                            return (
                              <button key={a.id} className={cls} onClick={() => vote(g, a)}>
                                {LETTERS[i]}
                              </button>
                            )
                          })}
                        </div>
                        <span className="muted" style={{ width: '1.2rem', textAlign: 'center' }}>
                          {v ? '✓' : ''}
                        </span>
                      </div>
                    )
                  })}
                </div>

                <div className="row">
                  {phase !== 'revealed' ? (
                    <button className="primary" onClick={reveal} disabled={!correct} style={{ flex: 1 }}>
                      {allVoted ? 'חשוף את התשובה 🎉' : `חשוף בכל זאת (${votedGroups.size}/${groups.length})`}
                    </button>
                  ) : (
                    <button className="primary" onClick={next} style={{ flex: 1 }}>
                      {currentIdx + 1 < questions.length ? 'לשאלה הבאה ←' : 'סיים את המשחק 🏁'}
                    </button>
                  )}
                </div>
                {phase === 'revealed' && (
                  <div className="muted">
                    אפשר עדיין לתקן רישום — לחיצה על אות אחרת מעדכנת, והניקוד מתעדכן לבד.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* ---- לוח ניקוד ---- */}
        <div className="card col" style={{ gap: '0.4rem' }}>
          <b>לוח ניקוד</b>
          {board.map((g) => (
            <div className="board-row" key={g.id}>
              <span className="board-rank">{g.rank}</span>
              <span className="entry-name" title="לחץ להתאמת ניקוד ידנית" style={{ cursor: 'pointer' }} onClick={() => adjustScore(g)}>
                {g.name}
                {g.adjustment ? (
                  <span className="muted"> ({g.adjustment > 0 ? '+' : ''}{g.adjustment})</span>
                ) : null}
              </span>
              <span className="board-score">{g.score}</span>
            </div>
          ))}
          {groups.length === 0 && <div className="muted">אין קבוצות עדיין.</div>}
          <div className="muted" style={{ marginTop: '0.5rem' }}>
            לחיצה על שם קבוצה — הוספה/הורדה ידנית של נקודות.
          </div>
        </div>
      </div>
    </>
  )
}

function HostCountdown({ endsAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  const remaining = Math.max(0, Math.ceil((endsAt - now) / 1000))
  return (
    <span className="chip" style={remaining <= 5 ? { color: 'var(--bad)' } : undefined}>
      ⏱ {remaining}
    </span>
  )
}
