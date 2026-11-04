import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmtMinutes, toISO, today } from '../utils.js'

export default function Friends() {
  const [data, setData] = useState(null)
  const [nickname, setNickname] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => setData(await api(`/api/friends?end=${toISO(today())}`)), [])

  useEffect(() => {
    let cancelled = false
    api(`/api/friends?end=${toISO(today())}`)
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && setMessage({ type: 'error', text: err.message }))
    return () => {
      cancelled = true
    }
  }, [])

  async function run(action, successText) {
    setMessage(null)
    setBusy(true)
    try {
      const result = await action()
      await load()
      if (successText) setMessage({ type: 'success', text: successText(result) })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  function sendRequest(e) {
    e.preventDefault()
    const target = nickname.trim()
    run(
      () => api('/api/friends/requests', { method: 'POST', body: { nickname: target } }),
      (r) => {
        setNickname('')
        return r.status === 'accepted' ? `${target}님과 친구가 되었어요.` : `${target}님에게 친구 요청을 보냈어요.`
      },
    )
  }

  const removeLink = (id, confirmText) => {
    if (confirmText && !confirm(confirmText)) return
    run(() => api(`/api/friends/${id}`, { method: 'DELETE' }))
  }

  if (!data) return <p className="muted">{message?.text ?? '불러오는 중…'}</p>

  const ranking = [{ ...data.me, isMe: true }, ...data.friends].sort((a, b) => b.week_minutes - a.week_minutes)
  const max = Math.max(60, ...ranking.map((r) => r.week_minutes))

  return (
    <div className="grid">
      <div className="stack">
        <section className="card">
          <h2>친구 추가</h2>
          <form className="row" onSubmit={sendRequest}>
            <input
              className="grow"
              required
              placeholder="친구 닉네임"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
            <button className="btn primary" disabled={busy}>
              요청 보내기
            </button>
          </form>
          <p className="hint">내 닉네임: <strong>{data.me.nickname}</strong> — 친구에게 알려 주세요.</p>
          {message && <p className={message.type}>{message.text}</p>}
        </section>

        {data.incoming.length > 0 && (
          <section className="card">
            <h2>받은 요청</h2>
            <ul className="list">
              {data.incoming.map((r) => (
                <li key={r.friendship_id}>
                  <span className="grow">{r.nickname}</span>
                  <button
                    className="btn primary small"
                    disabled={busy}
                    onClick={() => run(() => api(`/api/friends/requests/${r.friendship_id}/accept`, { method: 'POST' }))}
                  >
                    수락
                  </button>
                  <button className="btn ghost small" disabled={busy} onClick={() => removeLink(r.friendship_id)}>
                    거절
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.outgoing.length > 0 && (
          <section className="card">
            <h2>보낸 요청</h2>
            <ul className="list">
              {data.outgoing.map((r) => (
                <li key={r.friendship_id}>
                  <span className="grow">{r.nickname}</span>
                  <span className="muted">대기 중</span>
                  <button className="btn ghost small" disabled={busy} onClick={() => removeLink(r.friendship_id)}>
                    취소
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <section className="card">
        <h2>최근 7일 랭킹</h2>
        {data.friends.length === 0 && <p className="muted">친구를 추가하면 함께 공부 시간을 비교할 수 있어요.</p>}
        <ol className="ranking">
          {ranking.map((r, i) => (
            <li key={r.id} className={r.isMe ? 'me' : ''}>
              <span className="rank">{i + 1}</span>
              <div className="grow">
                <div className="rank-head">
                  <span>
                    {r.nickname}
                    {r.isMe && <span className="badge">나</span>}
                  </span>
                  <strong>{fmtMinutes(r.week_minutes)}</strong>
                </div>
                <div className="rank-bar">
                  <span style={{ width: `${(r.week_minutes / max) * 100}%` }} />
                </div>
              </div>
              {!r.isMe && (
                <button
                  className="btn ghost small"
                  disabled={busy}
                  onClick={() => removeLink(r.friendship_id, `${r.nickname}님을 친구에서 삭제할까요?`)}
                >
                  삭제
                </button>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
