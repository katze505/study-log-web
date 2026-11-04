import { useState } from 'react'
import { api } from '../api.js'

export default function AuthPage({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email: '', password: '', nickname: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const body = mode === 'login' ? { email: form.email, password: form.password } : form
      onAuth(await api(`/api/auth/${mode}`, { method: 'POST', body, auth: false }))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="auth">
        <h1 className="auth-title">
          <span className="logo">▍</span>스터디로그
        </h1>
        <p className="muted">일반 공부와 개발 스터디를 한곳에서 기록하세요.</p>

        <div className="segmented">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')} type="button">
            로그인
          </button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')} type="button">
            회원가입
          </button>
        </div>

        <form className="card form" onSubmit={submit}>
          <label>
            이메일
            <input type="email" required autoComplete="email" value={form.email} onChange={update('email')} />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              required
              minLength={mode === 'signup' ? 6 : undefined}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={form.password}
              onChange={update('password')}
            />
          </label>
          {mode === 'signup' && (
            <label>
              닉네임 <span className="hint">친구가 이 이름으로 나를 찾아요 · 한글/영문/숫자/_ 2~20자</span>
              <input
                required
                pattern="[가-힣A-Za-z0-9_]{2,20}"
                value={form.nickname}
                onChange={update('nickname')}
              />
            </label>
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={busy}>
            {busy ? '잠시만요…' : mode === 'login' ? '로그인' : '가입하고 시작하기'}
          </button>
        </form>
      </div>
    </div>
  )
}
