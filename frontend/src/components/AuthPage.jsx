import { useState } from 'react'
import { api } from '../api.js'
import { EMAIL_DOMAINS } from '../utils.js'
import Modal from './Modal.jsx'

const CUSTOM = 'custom'

function EmailField({ local, domain, customDomain, onChange }) {
  // 아이디 칸에 '@'까지 붙여넣으면 아이디/도메인으로 나눠서 채움
  function changeLocal(e) {
    const [id, host] = e.target.value.split('@')
    if (host === undefined) return onChange({ local: id })
    const known = EMAIL_DOMAINS.includes(host.toLowerCase())
    onChange({ local: id, domain: known ? host.toLowerCase() : CUSTOM, customDomain: known ? customDomain : host })
  }

  return (
    <div className="label">
      이메일
      <div className="email-field">
        <input required autoComplete="username" aria-label="이메일 아이디" value={local} onChange={changeLocal} />
        <span className="at">@</span>
        <select aria-label="이메일 도메인" value={domain} onChange={(e) => onChange({ domain: e.target.value })}>
          {EMAIL_DOMAINS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          <option value={CUSTOM}>직접 입력</option>
        </select>
      </div>
      {domain === CUSTOM && (
        <input
          required
          placeholder="예: tukorea.ac.kr"
          aria-label="이메일 도메인 직접 입력"
          pattern="[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"
          value={customDomain}
          onChange={(e) => onChange({ customDomain: e.target.value.trim() })}
        />
      )}
    </div>
  )
}

export default function AuthPage({ onAuth }) {
  const [mode, setMode] = useState('login') // login | signup | mfa
  const [form, setForm] = useState({
    local: '',
    domain: EMAIL_DOMAINS[0],
    customDomain: '',
    password: '',
    nickname: '',
  })
  const [mfa, setMfa] = useState(null) // { mfa_token, factor_id }
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(null) // { title, text, actions }
  const [busy, setBusy] = useState(false)

  const email = `${form.local.trim()}@${form.domain === CUSTOM ? form.customDomain : form.domain}`
  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  const closeAlert = () => setNotice(null)

  function switchMode(next) {
    setMode(next)
    setError('')
    setCode('')
  }

  function loginFailed(err) {
    if (err.status === 404) {
      setNotice({
        title: '회원 정보가 없어요',
        text: `${email}(으)로 가입된 계정을 찾지 못했어요. 이메일을 다시 확인하거나 회원가입해 주세요.`,
        actions: [
          { label: '다시 입력', onClick: closeAlert },
          {
            label: '회원가입하기',
            primary: true,
            onClick: () => {
              closeAlert()
              switchMode('signup')
            },
          },
        ],
      })
    } else if (err.status === 401) {
      setNotice({ title: '비밀번호가 틀렸어요', text: '아이디(이메일)와 비밀번호를 다시 확인해 주세요.' })
      setForm((f) => ({ ...f, password: '' }))
    } else {
      setNotice({ title: '로그인하지 못했어요', text: err.message })
    }
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') {
        const result = await api('/api/auth/login', { method: 'POST', body: { email, password: form.password }, auth: false })
        if (result.mfa_required) {
          setMfa(result)
          switchMode('mfa')
        } else {
          onAuth(result)
          return
        }
      } else if (mode === 'signup') {
        await api('/api/auth/signup', {
          method: 'POST',
          body: { email, password: form.password, nickname: form.nickname },
          auth: false,
        })
        setForm((f) => ({ ...f, password: '', nickname: '' }))
        switchMode('login')
        setNotice({ title: '회원가입 완료!', text: `${email} 계정이 만들어졌어요. 방금 만든 비밀번호로 로그인해 주세요.` })
      } else {
        onAuth(await api('/api/auth/login/mfa', { method: 'POST', body: { ...mfa, code }, auth: false }))
        return
      }
    } catch (err) {
      if (mode === 'login') loginFailed(err)
      else if (mode === 'mfa' && err.status === 401) {
        switchMode('login')
        setNotice({ title: '인증 시간이 지났어요', text: err.message })
      } else setError(err.message)
    }
    setBusy(false)
  }

  return (
    <div className="center-screen">
      <div className="auth">
        <h1 className="auth-title">
          <span className="logo">▍</span>스터디로그
        </h1>
        <p className="muted">일반 공부와 개발 스터디를 한곳에서 기록하세요.</p>

        {mode !== 'mfa' && (
          <div className="segmented">
            <button className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')} type="button">
              로그인
            </button>
            <button className={mode === 'signup' ? 'active' : ''} onClick={() => switchMode('signup')} type="button">
              회원가입
            </button>
          </div>
        )}

        <form className="card form" onSubmit={submit}>
          {mode === 'mfa' ? (
            <>
              <h2 className="no-margin">2차 인증</h2>
              <p className="muted small-text">인증 앱(Google Authenticator 등)에 표시된 6자리 코드를 입력해 주세요.</p>
              <label>
                인증 코드
                <input
                  required
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  className="otp"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </label>
            </>
          ) : (
            <>
              <EmailField {...form} onChange={(patch) => setForm({ ...form, ...patch })} />
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
            </>
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={busy}>
            {busy ? '잠시만요…' : { login: '로그인', signup: '가입하기', mfa: '확인' }[mode]}
          </button>
          {mode !== 'login' && (
            <button type="button" className="link-btn" onClick={() => switchMode('login')}>
              ← 로그인 화면으로 돌아가기
            </button>
          )}
        </form>
      </div>

      {notice && (
        <Modal title={notice.title} actions={notice.actions} onClose={closeAlert}>
          <p>{notice.text}</p>
        </Modal>
      )}
    </div>
  )
}
