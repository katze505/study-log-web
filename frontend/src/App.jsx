import { useCallback, useEffect, useState } from 'react'
import { api, getSession, setSession } from './api.js'
import AuthPage from './components/AuthPage.jsx'
import Dashboard from './components/Dashboard.jsx'
import Friends from './components/Friends.jsx'
import Subjects from './components/Subjects.jsx'
import { HISTORY_DAYS, addDays, toISO, today } from './utils.js'

const TABS = [
  { id: 'record', label: '기록' },
  { id: 'subjects', label: '과목' },
  { id: 'friends', label: '친구' },
]

function sessionsPath() {
  const end = today()
  return `/api/sessions?start=${toISO(addDays(end, -(HISTORY_DAYS - 1)))}&end=${toISO(end)}`
}

export default function App() {
  const [auth, setAuth] = useState(getSession)
  const [me, setMe] = useState(null)
  const [subjects, setSubjects] = useState([])
  const [sessions, setSessions] = useState([])
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState('record')

  const logout = useCallback(() => {
    setSession(null)
    setAuth(null)
    setMe(null)
    setSubjects([])
    setSessions([])
    setLoadError('')
  }, [])

  useEffect(() => {
    window.addEventListener('studylog:logout', logout)
    return () => window.removeEventListener('studylog:logout', logout)
  }, [logout])

  useEffect(() => {
    if (!auth) return
    let cancelled = false
    Promise.all([api('/api/me'), api('/api/subjects'), api(sessionsPath())])
      .then(([profile, subjectRows, sessionRows]) => {
        if (cancelled) return
        setMe(profile)
        setSubjects(subjectRows)
        setSessions(sessionRows)
      })
      .catch((e) => !cancelled && setLoadError(e.message))
    return () => {
      cancelled = true
    }
  }, [auth])

  const reloadSubjects = useCallback(async () => setSubjects(await api('/api/subjects')), [])
  const reloadSessions = useCallback(async () => setSessions(await api(sessionsPath())), [])

  const handleAuth = (session) => {
    setSession(session)
    setLoadError('')
    setAuth(session)
  }

  if (!auth) return <AuthPage onAuth={handleAuth} />

  if (!me) {
    return (
      <div className="center-screen">
        {loadError ? (
          <div className="card narrow">
            <p className="error">{loadError}</p>
            <button className="btn" onClick={logout}>
              다시 로그인
            </button>
          </div>
        ) : (
          <p className="muted">불러오는 중…</p>
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">▍</span>스터디로그
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="user">
          <span className="nickname">{me.nickname}</span>
          <button className="btn ghost small" onClick={logout}>
            로그아웃
          </button>
        </div>
      </header>

      <main className="content">
        {tab === 'record' && (
          <Dashboard
            subjects={subjects}
            sessions={sessions}
            onChanged={reloadSessions}
            goToSubjects={() => setTab('subjects')}
          />
        )}
        {tab === 'subjects' && <Subjects subjects={subjects} onChanged={reloadSubjects} />}
        {tab === 'friends' && <Friends />}
      </main>
    </div>
  )
}
