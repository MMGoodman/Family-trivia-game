import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { correctAnswerOf } from '../lib/scoring'

const LETTERS = ['א', 'ב', 'ג', 'ד']

export default function GameEditor() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null)
  const [newGroup, setNewGroup] = useState('')

  async function reload() {
    try {
      setState(await api.loadFullGame(gameId))
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  if (error) return <div className="app banner">{error}</div>
  if (!state) return <div className="center-screen muted">טוען…</div>

  const { game, groups, questions } = state

  // ---------- קבוצות ----------

  async function addGroup(e) {
    e.preventDefault()
    const name = newGroup.trim()
    if (!name) return
    setNewGroup('')
    await api.addGroup(gameId, name, groups.length)
    reload()
  }

  async function renameGroup(g) {
    const name = prompt('שם הקבוצה:', g.name)
    if (!name || name === g.name) return
    await api.updateGroup(g.id, { name })
    reload()
  }

  async function removeGroup(g) {
    if (!confirm(`להסיר את "${g.name}"? כל ההצבעות שלה יימחקו.`)) return
    await api.deleteGroup(g.id)
    reload()
  }

  // ---------- שאלות ----------

  async function addQuestion() {
    const q = await api.addQuestion(gameId, questions.length)
    await reload()
    setOpenId(q.id)
  }

  async function removeQuestion(q) {
    if (!confirm('למחוק את השאלה?')) return
    await api.deleteQuestion(q.id)
    if (q.image_path) await api.removeQuestionImage(q.image_path)
    reload()
  }

  async function move(q, delta) {
    const idx = questions.findIndex((x) => x.id === q.id)
    const target = idx + delta
    if (target < 0 || target >= questions.length) return
    const reordered = [...questions]
    const [item] = reordered.splice(idx, 1)
    reordered.splice(target, 0, item)
    await api.reorderQuestions(reordered.map((x, i) => ({ id: x.id, position: i })))
    reload()
  }

  const readyCount = questions.filter(isReady).length

  return (
    <>
      <div className="topbar">
        <button className="ghost" onClick={() => navigate('/')}>
          ← המשחקים שלי
        </button>
        <h1>{game.name}</h1>
        <div className="spacer" />
        <span className="muted">
          {readyCount}/{questions.length} שאלות מוכנות
        </span>
        <button
          className="primary"
          onClick={() => navigate(`/game/${gameId}/host`)}
          disabled={readyCount === 0 || groups.length === 0}
        >
          התחל לשחק
        </button>
      </div>

      <div className="app col" style={{ gap: '2rem' }}>
        {/* ----- קבוצות ----- */}
        <section className="col">
          <h2 style={{ margin: 0 }}>קבוצות</h2>
          <div className="muted">
            כל משפחה היא קבוצה אחת שמרימה פתק אחד. אפשר גם לרשום שחקנים בודדים.
          </div>

          <div className="card col">
            {groups.length === 0 && <div className="muted">עדיין אין קבוצות.</div>}
            {groups.map((g) => (
              <div className="row" key={g.id}>
                <span style={{ flex: 1 }}>{g.name}</span>
                <button className="ghost" onClick={() => renameGroup(g)}>
                  שנה שם
                </button>
                <button className="ghost danger" onClick={() => removeGroup(g)}>
                  הסר
                </button>
              </div>
            ))}
            <form className="row" onSubmit={addGroup}>
              <input
                placeholder="שם קבוצה — למשל: משפחת כהן"
                value={newGroup}
                onChange={(e) => setNewGroup(e.target.value)}
              />
              <button type="submit" disabled={!newGroup.trim()}>
                הוסף
              </button>
            </form>
          </div>
        </section>

        {/* ----- שאלות ----- */}
        <section className="col">
          <div className="row">
            <h2 style={{ margin: 0, flex: 1 }}>שאלות</h2>
            <button className="primary" onClick={addQuestion}>
              + שאלה חדשה
            </button>
          </div>

          {questions.length === 0 && (
            <div className="card muted">אין עדיין שאלות. הוסף אחת כדי להתחיל.</div>
          )}

          {questions.map((q, i) => (
            <QuestionItem
              key={q.id}
              q={q}
              index={i}
              gameId={gameId}
              open={openId === q.id}
              onToggle={() => setOpenId(openId === q.id ? null : q.id)}
              onChanged={reload}
              onDelete={() => removeQuestion(q)}
              onMoveUp={() => move(q, -1)}
              onMoveDown={() => move(q, 1)}
              isFirst={i === 0}
              isLast={i === questions.length - 1}
            />
          ))}
        </section>
      </div>
    </>
  )
}

function isReady(q) {
  const filled = (q.answers || []).filter((a) => a.text.trim())
  return Boolean((q.text?.trim() || q.image_path) && filled.length >= 2 && correctAnswerOf(q))
}

function QuestionItem({
  q,
  index,
  gameId,
  open,
  onToggle,
  onChanged,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}) {
  const [text, setText] = useState(q.text || '')
  const [answers, setAnswers] = useState(q.answers)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    setText(q.text || '')
    setAnswers(q.answers)
  }, [q])

  const ready = isReady({ ...q, text, answers })

  async function saveText() {
    if (text === (q.text || '')) return
    await api.updateQuestion(q.id, { text })
    onChanged()
  }

  async function saveAnswer(a, value) {
    setAnswers(answers.map((x) => (x.id === a.id ? { ...x, text: value } : x)))
  }

  async function commitAnswer(a) {
    const local = answers.find((x) => x.id === a.id)
    if (local.text === a.text) return
    await api.updateAnswer(a.id, { text: local.text })
    onChanged()
  }

  async function markCorrect(a) {
    await api.setCorrectAnswer(q.id, a.id)
    onChanged()
  }

  async function setWeight(w) {
    await api.updateQuestion(q.id, { weight: w })
    onChanged()
  }

  async function addOption() {
    await api.addAnswer(q.id, answers.length)
    onChanged()
  }

  async function removeOption(a) {
    await api.deleteAnswer(a.id)
    onChanged()
  }

  async function onImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      if (q.image_path) await api.removeQuestionImage(q.image_path)
      const path = await api.uploadQuestionImage(gameId, q.id, file)
      await api.updateQuestion(q.id, { image_path: path })
      onChanged()
    } finally {
      setUploading(false)
    }
  }

  async function clearImage() {
    await api.removeQuestionImage(q.image_path)
    await api.updateQuestion(q.id, { image_path: null })
    onChanged()
  }

  return (
    <div className={`q-item ${open ? 'open' : ''}`}>
      <div className="q-head" onClick={onToggle}>
        <span className="q-num">{index + 1}</span>
        <span className="q-title">{text || (q.image_path ? '(שאלת תמונה)' : 'שאלה ריקה')}</span>
        <span className="chip">{q.weight} נק'</span>
        <span className={`chip ${ready ? 'ok' : 'warn'}`}>{ready ? 'מוכנה' : 'חסר מידע'}</span>
        <span className="muted">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="col" style={{ gap: '1rem', marginTop: '1rem' }}>
          <label className="col" style={{ gap: '0.3rem' }}>
            <span className="muted">נוסח השאלה</span>
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={saveText}
              placeholder="מה השאלה?"
            />
          </label>

          <div className="row wrap">
            <span className="muted">תמונה:</span>
            {q.image_path ? (
              <>
                <img
                  src={api.imageUrl(q.image_path)}
                  alt=""
                  style={{ height: 60, borderRadius: 8 }}
                />
                <button className="ghost danger" onClick={clearImage}>
                  הסר תמונה
                </button>
              </>
            ) : (
              <span className="muted">אין</span>
            )}
            <label className="chip" style={{ cursor: 'pointer' }}>
              {uploading ? 'מעלה…' : q.image_path ? 'החלף' : 'העלה תמונה'}
              <input type="file" accept="image/*" hidden onChange={onImage} />
            </label>
          </div>

          <div className="col" style={{ gap: '0.5rem' }}>
            <span className="muted">תשובות — לחץ על העיגול כדי לסמן את הנכונה</span>
            {answers.map((a, i) => (
              <div className="answer-row" key={a.id}>
                <button
                  className={`correct-toggle ${a.is_correct ? 'on' : ''}`}
                  onClick={() => markCorrect(a)}
                  title="סמן כתשובה הנכונה"
                >
                  {a.is_correct ? '✓' : LETTERS[i]}
                </button>
                <input
                  value={a.text}
                  onChange={(e) => saveAnswer(a, e.target.value)}
                  onBlur={() => commitAnswer(a)}
                  placeholder={`תשובה ${LETTERS[i]}`}
                />
                {answers.length > 2 && (
                  <button className="ghost danger" onClick={() => removeOption(a)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {answers.length < 4 && (
              <button className="ghost" onClick={addOption}>
                + הוסף תשובה
              </button>
            )}
          </div>

          <div className="row">
            <span className="muted">כמה השאלה שווה:</span>
            <div className="weight-picker">
              {[1, 2, 3, 4, 5].map((w) => (
                <button key={w} className={q.weight === w ? 'on' : ''} onClick={() => setWeight(w)}>
                  {w}
                </button>
              ))}
            </div>
            <div className="spacer" />
            <button className="ghost" onClick={onMoveUp} disabled={isFirst}>
              ↑
            </button>
            <button className="ghost" onClick={onMoveDown} disabled={isLast}>
              ↓
            </button>
            <button className="ghost danger" onClick={onDelete}>
              מחק שאלה
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
