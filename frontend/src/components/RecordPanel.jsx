import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { CATEGORY, fmtMinutes, toISO, today } from '../utils.js'

const TIMER_KEY = 'studylog.timer'

function loadTimer() {
  try {
    return JSON.parse(localStorage.getItem(TIMER_KEY))
  } catch {
    return null
  }
}

function saveTimer(timer) {
  try {
    if (timer) localStorage.setItem(TIMER_KEY, JSON.stringify(timer))
    else localStorage.removeItem(TIMER_KEY)
  } catch {
    // 저장소를 못 쓰면 새로고침 시 타이머가 초기화될 뿐
  }
}

function clock(ms) {
  const s = Math.floor(ms / 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export default function RecordPanel({ subjects, onSaved, goToSubjects }) {
  const [timer, setTimer] = useState(loadTimer) // { startedAt, subjectId } — 새로고침해도 유지
  const [now, setNow] = useState(() => Date.now())
  const [subjectId, setSubjectId] = useState(() => loadTimer()?.subjectId ?? '')
  const [hours, setHours] = useState('0')
  const [minutes, setMinutes] = useState('30')
  const [date, setDate] = useState(() => toISO(today()))
  const [memo, setMemo] = useState('')
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)

  const selectedId = subjects.some((s) => s.id === subjectId) ? subjectId : (subjects[0]?.id ?? '')
  const timerSubject = timer && subjects.find((s) => s.id === timer.subjectId)

  useEffect(() => {
    if (!timer) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timer])

  if (!subjects.length) {
    return (
      <section className="card">
        <h2>공부 기록하기</h2>
        <p className="muted">먼저 공부할 과목을 추가해 주세요. 일반 공부와 개발 스터디로 나눠서 관리할 수 있어요.</p>
        <button className="btn primary" onClick={goToSubjects}>
          과목 추가하러 가기
        </button>
      </section>
    )
  }

  function startTimer() {
    const next = { startedAt: Date.now(), subjectId: selectedId }
    saveTimer(next)
    setTimer(next)
    setNow(next.startedAt)
    setMessage(null)
  }

  function stopTimer() {
    const total = Math.min(1440, Math.max(1, Math.round((Date.now() - timer.startedAt) / 60000)))
    setSubjectId(timer.subjectId)
    setHours(String(Math.floor(total / 60)))
    setMinutes(String(total % 60))
    setDate(toISO(today()))
    saveTimer(null)
    setTimer(null)
    setMessage({ type: 'info', text: `${fmtMinutes(total)} 측정했어요. 확인하고 저장을 눌러 주세요.` })
  }

  function cancelTimer() {
    saveTimer(null)
    setTimer(null)
  }

  async function submit(e) {
    e.preventDefault()
    const total = Number(hours || 0) * 60 + Number(minutes || 0)
    if (!Number.isInteger(total) || total < 1 || total > 1440) {
      setMessage({ type: 'error', text: '공부 시간은 1분 이상 24시간 이하로 입력해 주세요.' })
      return
    }
    setBusy(true)
    try {
      await api('/api/sessions', {
        method: 'POST',
        body: { subject_id: selectedId, duration_minutes: total, studied_on: date, memo: memo || null },
      })
      await onSaved()
      setMemo('')
      setMessage({ type: 'success', text: `${fmtMinutes(total)} 기록했어요.` })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>공부 기록하기</h2>

      <div className={timer ? 'timer running' : 'timer'}>
        <div className="timer-clock">{clock(timer ? now - timer.startedAt : 0)}</div>
        <div className="timer-sub">
          {timer ? (timerSubject ? `${timerSubject.name} 공부 중` : '측정 중') : '타이머로 측정하거나 아래에 직접 입력하세요'}
        </div>
        <div className="row">
          {timer ? (
            <>
              <button className="btn primary" onClick={stopTimer}>
                정지
              </button>
              <button className="btn ghost" onClick={cancelTimer}>
                취소
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={startTimer}>
              ▶ 타이머 시작
            </button>
          )}
        </div>
      </div>

      <form className="form" onSubmit={submit}>
        <label>
          과목
          <select value={selectedId} onChange={(e) => setSubjectId(e.target.value)} disabled={!!timer}>
            {Object.entries(CATEGORY).map(([key, cat]) => {
              const items = subjects.filter((s) => s.category === key)
              return (
                items.length > 0 && (
                  <optgroup key={key} label={cat.label}>
                    {items.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                )
              )
            })}
          </select>
        </label>
        <div className="row">
          <label className="grow">
            시간
            <input type="number" min="0" max="24" value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <label className="grow">
            분
            <input type="number" min="0" max="59" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </label>
          <label className="grow">
            날짜
            <input type="date" required max={toISO(today())} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label>
          메모 <span className="hint">선택</span>
          <input
            maxLength={500}
            placeholder="예: 리액트 훅 정리, 알고리즘 3문제"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </label>
        {message && <p className={message.type}>{message.text}</p>}
        <button className="btn primary" disabled={busy || !!timer}>
          {busy ? '저장 중…' : '기록 저장'}
        </button>
      </form>
    </section>
  )
}
