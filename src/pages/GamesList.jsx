import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { listGames, createGame, deleteGame, updateGame } from '../lib/api'
import { exportGame, importGame } from '../lib/transfer'

export default function GamesList() {
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const navigate = useNavigate()

  async function refresh() {
    try {
      setGames(await listGames())
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function onCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setBusy(true)
    try {
      const game = await createGame(newName.trim())
      setNewName('')
      navigate(`/game/${game.id}/edit`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(game) {
    if (!confirm(`למחוק את "${game.name}" לצמיתות? כל השאלות והניקוד יימחקו.`)) return
    try {
      await deleteGame(game.id)
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  async function onRename(game) {
    const name = prompt('שם חדש למשחק:', game.name)
    if (!name || name === game.name) return
    await updateGame(game.id, { name })
    refresh()
  }

  const [importing, setImporting] = useState(false)

  async function onImportFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setImporting(true)
    try {
      await importGame(JSON.parse(await file.text()))
      await refresh()
    } catch (err) {
      setError('הייבוא נכשל: ' + err.message)
    } finally {
      setBusy(false)
      setImporting(false)
    }
  }

  return (
    <>
      <div className="topbar">
        <h1>המשחקים שלי</h1>
        <div className="spacer" />
        <button className="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
          ייבוא מקובץ
        </button>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>
          יציאה
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          hidden
          onChange={onImportFile}
        />
      </div>

      <div className="app col" style={{ gap: '1.5rem' }}>
        <form className="card row" onSubmit={onCreate}>
          <input
            placeholder='שם המשחק — למשל "חופשת קיץ 2026"'
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="primary" type="submit" disabled={busy || !newName.trim()}>
            צור משחק
          </button>
        </form>

        {error && <div className="banner">{error}</div>}
        {importing && <div className="banner info">מייבא את המשחק… אל תסגור את הדף.</div>}

        {loading ? (
          <div className="muted">טוען…</div>
        ) : games.length === 0 ? (
          <div className="card muted">
            עדיין אין משחקים. צור אחד למעלה, ואז תוסיף לו קבוצות ושאלות.
          </div>
        ) : (
          <div className="game-grid">
            {games.map((g) => (
              <div className="game-card" key={g.id}>
                <h3>{g.name}</h3>
                <div className="muted">נוצר ב-{new Date(g.created_at).toLocaleDateString('he-IL')}</div>
                <div className="row wrap" style={{ marginTop: 'auto', paddingTop: '0.6rem' }}>
                  <button className="primary" onClick={() => navigate(`/game/${g.id}/host`)}>
                    שחק
                  </button>
                  <button onClick={() => navigate(`/game/${g.id}/edit`)}>עריכה</button>
                  <button className="ghost" onClick={() => onRename(g)}>
                    שנה שם
                  </button>
                  <button className="ghost" onClick={() => exportGame(g.id)}>
                    ייצוא
                  </button>
                  <button className="ghost danger" onClick={() => onDelete(g)}>
                    מחק
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
