import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import { correctAnswerOf } from '../lib/scoring'
import { confirmDialog, promptDialog } from '../components/dialog'

const LETTERS = ['א', 'ב', 'ג', 'ד']

// העורך עובד "מקומי קודם": כל שינוי מתעדכן מיד במסך ונשמר ברקע.
// אין טעינה מחדש מהשרת אחרי כל פעולה — כדי שטקסט באמצע הקלדה לא יימחק.
export default function GameEditor() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null)
  const [newGroup, setNewGroup] = useState('')
  const dirty = useRef(false)

  useEffect(() => {
    // מציגים מיד את העותק המקומי, ומתרעננים מהשרת ברקע.
    // אם המשתמש כבר התחיל לערוך — לא דורסים את מה שהוא עושה.
    const cached = api.readCachedGame(gameId)
    if (cached) setState((s) => s ?? cached)
    api
      .loadFullGame(gameId)
      .then((fresh) => setState((s) => (dirty.current ? s : fresh)))
      .catch((e) => setError(e.message))
  }, [gameId])

  if (error) return <div className="app banner">{error}</div>
  if (!state) return <div className="center-screen muted">טוען…</div>

  const { game, groups, questions } = state

  function fail(e) {
    setError('שגיאה בשמירה: ' + e.message)
  }

  // ---------- עדכוני מצב מקומיים ----------

  function patchQuestion(qid, patch) {
    dirty.current = true
    setState((s) => ({
      ...s,
      questions: s.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)),
    }))
  }

  function patchAnswer(qid, aid, patch) {
    dirty.current = true
    setState((s) => ({
      ...s,
      questions: s.questions.map((q) =>
        q.id === qid
          ? { ...q, answers: q.answers.map((a) => (a.id === aid ? { ...a, ...patch } : a)) }
          : q,
      ),
    }))
  }

  // ---------- קבוצות ----------

  async function addGroup(e) {
    e.preventDefault()
    const name = newGroup.trim()
    if (!name) return
    setNewGroup('')
    try {
      const g = await api.addGroup(gameId, name, groups.length)
      setState((s) => ({ ...s, groups: [...s.groups, g] }))
    } catch (e) {
      fail(e)
    }
  }

  async function renameGroup(g) {
    const name = await promptDialog({
      title: 'שינוי שם קבוצה',
      defaultValue: g.name,
      confirmText: 'שמור',
    })
    if (!name || name === g.name) return
    setState((s) => ({
      ...s,
      groups: s.groups.map((x) => (x.id === g.id ? { ...x, name } : x)),
    }))
    api.updateGroup(g.id, { name }).catch(fail)
  }

  async function removeGroup(g) {
    const ok = await confirmDialog({
      title: `להסיר את "${g.name}"?`,
      message: 'כל התשובות שהקבוצה רשמה במשחק יימחקו.',
      confirmText: 'הסר קבוצה',
      danger: true,
    })
    if (!ok) return
    setState((s) => ({ ...s, groups: s.groups.filter((x) => x.id !== g.id) }))
    api.deleteGroup(g.id).catch(fail)
  }

  // ---------- שאלות ----------

  async function addQuestion() {
    try {
      const q = await api.addQuestion(gameId, questions.length)
      setState((s) => ({ ...s, questions: [...s.questions, q] }))
      setOpenId(q.id)
    } catch (e) {
      fail(e)
    }
  }

  async function removeQuestion(q) {
    const ok = await confirmDialog({
      title: 'למחוק את השאלה?',
      message: q.text ? `"${q.text}"` : 'שאלת תמונה',
      confirmText: 'מחק שאלה',
      danger: true,
    })
    if (!ok) return
    setState((s) => ({ ...s, questions: s.questions.filter((x) => x.id !== q.id) }))
    try {
      await api.deleteQuestion(q.id)
      if (q.image_path) await api.removeQuestionImage(q.image_path)
    } catch (e) {
      fail(e)
    }
  }

  async function move(q, delta) {
    const idx = questions.findIndex((x) => x.id === q.id)
    const target = idx + delta
    if (target < 0 || target >= questions.length) return
    const reordered = [...questions]
    const [item] = reordered.splice(idx, 1)
    reordered.splice(target, 0, item)
    const withPos = reordered.map((x, i) => ({ ...x, position: i }))
    setState((s) => ({ ...s, questions: withPos }))
    api.reorderQuestions(withPos.map((x) => ({ id: x.id, position: x.position }))).catch(fail)
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
          title={
            groups.length === 0
              ? 'הוסף לפחות קבוצה אחת'
              : readyCount === 0
                ? 'צריך לפחות שאלה אחת מוכנה (נוסח, 2+ תשובות וסימון הנכונה)'
                : ''
          }
        >
          התחל לשחק
        </button>
      </div>

      <div className="app col" style={{ gap: '2rem' }}>
        {error && (
          <div className="banner" onClick={() => setError('')} style={{ cursor: 'pointer' }}>
            {error} (לחץ לסגירה)
          </div>
        )}

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
              patchQuestion={patchQuestion}
              patchAnswer={patchAnswer}
              onDelete={() => removeQuestion(q)}
              onMoveUp={() => move(q, -1)}
              onMoveDown={() => move(q, 1)}
              isFirst={i === 0}
              isLast={i === questions.length - 1}
              onError={fail}
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
  patchQuestion,
  patchAnswer,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  onError,
}) {
  const [uploading, setUploading] = useState(false)
  const ready = isReady(q)

  // שמירה ברקע: המסך כבר עודכן, רק מסנכרנים לשרת
  const save = (promise) => promise.catch(onError)

  function markCorrect(a) {
    // עדכון מקומי מיידי של כל התשובות, ואז שמירה
    q.answers.forEach((x) => patchAnswer(q.id, x.id, { is_correct: x.id === a.id }))
    save(api.setCorrectAnswer(q.id, a.id))
  }

  async function addOption() {
    try {
      const a = await api.addAnswer(q.id, q.answers.length)
      patchQuestion(q.id, { answers: [...q.answers, a] })
    } catch (e) {
      onError(e)
    }
  }

  function removeOption(a) {
    patchQuestion(q.id, { answers: q.answers.filter((x) => x.id !== a.id) })
    save(api.deleteAnswer(a.id))
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
      patchQuestion(q.id, { image_path: path })
    } catch (e) {
      onError(e)
    } finally {
      setUploading(false)
    }
  }

  function clearImage() {
    const old = q.image_path
    patchQuestion(q.id, { image_path: null })
    save(api.removeQuestionImage(old).then(() => api.updateQuestion(q.id, { image_path: null })))
  }

  return (
    <div className={`q-item ${open ? 'open' : ''}`}>
      <div className="q-head" onClick={onToggle}>
        <span className="q-num">{index + 1}</span>
        <span className="q-title">{q.text || (q.image_path ? '(שאלת תמונה)' : 'שאלה ריקה')}</span>
        <span className="chip">{q.weight} נק'</span>
        <span className={`chip ${ready ? 'ok' : 'warn'}`} title="מוכנה = נוסח או תמונה, לפחות 2 תשובות, וסימון הנכונה">
          {ready ? 'מוכנה' : 'חסר מידע'}
        </span>
        <span className="muted">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="col" style={{ gap: '1rem', marginTop: '1rem' }}>
          <label className="col" style={{ gap: '0.3rem' }}>
            <span className="muted">נוסח השאלה</span>
            <textarea
              rows={2}
              value={q.text || ''}
              onChange={(e) => patchQuestion(q.id, { text: e.target.value })}
              onBlur={() => save(api.updateQuestion(q.id, { text: q.text || '' }))}
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
            <span className="muted">
              תשובות — אפשר למלא הכל ולסמן את הנכונה מתי שנוח (לחיצה על העיגול)
            </span>
            {q.answers.map((a, i) => (
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
                  onChange={(e) => patchAnswer(q.id, a.id, { text: e.target.value })}
                  onBlur={() => save(api.updateAnswer(a.id, { text: a.text }))}
                  placeholder={`תשובה ${LETTERS[i]}`}
                />
                {q.answers.length > 2 && (
                  <button className="ghost danger" onClick={() => removeOption(a)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {q.answers.length < 4 && (
              <button className="ghost" onClick={addOption}>
                + הוסף תשובה
              </button>
            )}
          </div>

          <div className="row">
            <span className="muted">כמה השאלה שווה:</span>
            <div className="weight-picker">
              {[1, 2, 3, 4, 5].map((w) => (
                <button
                  key={w}
                  className={q.weight === w ? 'on' : ''}
                  onClick={() => {
                    patchQuestion(q.id, { weight: w })
                    save(api.updateQuestion(q.id, { weight: w }))
                  }}
                >
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
