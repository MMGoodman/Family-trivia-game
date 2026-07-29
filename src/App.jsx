import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import GamesList from './pages/GamesList'
import GameEditor from './pages/GameEditor'
import HostScreen from './pages/HostScreen'
import DisplayScreen from './pages/DisplayScreen'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (loading) return <div className="center-screen muted">טוען…</div>
  if (!session) return <Login />

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<GamesList />} />
        <Route path="/game/:gameId/edit" element={<GameEditor />} />
        <Route path="/game/:gameId/host" element={<HostScreen />} />
        <Route path="/game/:gameId/display" element={<DisplayScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
