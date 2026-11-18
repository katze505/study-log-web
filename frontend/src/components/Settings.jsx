import { useState } from 'react'
import { api } from '../api.js'

export default function Settings({ me, onSession, onChanged }) {
  const [setup, setSetup] = useState(null) // { factor_id, qr_code, secret }
  const [code, setCode] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  async function run(action) {
    setMessage(null)
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  const startSetup = () =>
    run(async () => {
      setSetup(await api('/api/auth/mfa/enroll', { method: 'POST' }))
      setCode('')
    })

  const activate = (e) => {
    e.preventDefault()
    run(async () => {
      // 활성화되면 2차 인증까지 통과한 새 세션으로 교체해야 계속 사용할 수 있음
      onSession(await api('/api/auth/mfa/activate', { method: 'POST', body: { factor_id: setup.factor_id, code } }))
      setSetup(null)
      await onChanged()
      setMessage({ type: 'success', text: '2차 인증을 켰어요. 다음 로그인부터 인증 코드를 입력해야 해요.' })
    })
  }

  const disable = () => {
    if (!confirm('2차 인증을 끌까요? 비밀번호만으로 로그인할 수 있게 돼요.')) return
    run(async () => {
      await api('/api/auth/mfa', { method: 'DELETE' })
      await onChanged()
      setMessage({ type: 'success', text: '2차 인증을 껐어요.' })
    })
  }

  return (
    <div className="grid">
      <section className="card">
        <h2>내 정보</h2>
        <dl className="info-list">
          <dt>이메일</dt>
          <dd>{me.email}</dd>
          <dt>닉네임</dt>
          <dd>{me.nickname}</dd>
          <dt>가입일</dt>
          <dd>{me.joined_at ? new Date(me.joined_at).toLocaleDateString('ko-KR') : '-'}</dd>
        </dl>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>로그인 2차 인증</h2>
          <span className={me.mfa_enabled ? 'badge on' : 'badge'}>{me.mfa_enabled ? '사용 중' : '꺼짐'}</span>
        </div>
        <p className="muted small-text">
          로그인할 때 비밀번호와 함께 인증 앱(Google Authenticator, Microsoft Authenticator 등)의 6자리 코드를 입력해 계정을 더
          안전하게 지켜요.
        </p>

        {me.mfa_enabled ? (
          <button className="btn" disabled={busy} onClick={disable}>
            2차 인증 끄기
          </button>
        ) : setup ? (
          <form className="form mfa-setup" onSubmit={activate}>
            <ol className="steps">
              <li>인증 앱에서 아래 QR 코드를 스캔하세요.</li>
              <li>앱에 표시된 6자리 코드를 입력하세요.</li>
            </ol>
            <img className="qr" src={setup.qr_code} alt="2차 인증 등록용 QR 코드" width={180} height={180} />
            <p className="hint">
              QR을 스캔할 수 없다면 이 키를 직접 입력하세요: <code className="secret">{setup.secret}</code>
            </p>
            <label>
              인증 코드
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                className="otp"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <div className="row">
              <button className="btn primary" disabled={busy}>
                확인하고 켜기
              </button>
              <button type="button" className="btn ghost" onClick={() => setSetup(null)}>
                취소
              </button>
            </div>
          </form>
        ) : (
          <button className="btn primary" disabled={busy} onClick={startSetup}>
            2차 인증 설정하기
          </button>
        )}
        {message && <p className={message.type}>{message.text}</p>}
      </section>
    </div>
  )
}
