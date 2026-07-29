import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) {
          setNotice('נשלח אליך מייל אימות. אשר אותו ואז התחבר.')
          setMode('signin')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(translate(err.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center-screen">
      <form className="card col" style={{ width: 'min(400px, 100%)', gap: '1rem' }} onSubmit={submit}>
        <div>
          <h2 style={{ margin: '0 0 0.25rem' }}>משחק טרוויה משפחתי</h2>
          <div className="muted">
            {mode === 'signin' ? 'התחבר כדי לראות את המשחקים שלך' : 'יצירת חשבון חדש'}
          </div>
        </div>

        <label className="col" style={{ gap: '0.3rem' }}>
          <span className="muted">אימייל</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="col" style={{ gap: '0.3rem' }}>
          <span className="muted">סיסמה</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <div className="banner">{error}</div>}
        {notice && <div className="banner info">{notice}</div>}

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'רגע…' : mode === 'signin' ? 'התחבר' : 'צור חשבון'}
        </button>

        <button
          type="button"
          className="ghost"
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError('')
            setNotice('')
          }}
        >
          {mode === 'signin' ? 'אין לי חשבון — הרשמה' : 'יש לי כבר חשבון — התחברות'}
        </button>
      </form>
    </div>
  )
}

function translate(msg = '') {
  if (msg.includes('Invalid login credentials')) return 'אימייל או סיסמה שגויים'
  if (msg.includes('already registered')) return 'האימייל הזה כבר רשום'
  if (msg.includes('Email not confirmed')) return 'המייל עדיין לא אומת — בדוק בתיבה שלך'
  if (msg.includes('at least 6')) return 'הסיסמה חייבת להיות באורך 6 תווים לפחות'
  if (msg.includes('Failed to fetch')) return 'אין חיבור לשרת. בדוק את האינטרנט.'
  return msg
}
