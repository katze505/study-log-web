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

const pad = (n) => String(n).padStart(2, '0')

function clock(ms) {
  const s = Math.floor(ms / 1000)
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

// 뽀모도로: 집중 → 휴식 → 집중 … 반복. 집중한 시간만 기록으로 저장
const POMODORO = { focus: [15, 25, 50], rest: [5, 10, 15] }

function phaseMs(t) {
  return (t.phase === 'focus' ? t.focusMin : t.breakMin) * 60000
}

// 시작 시각 기준으로 계산하므로 탭을 닫았다 와도 지난 구간까지 따라잡음
function advance(t, now) {
  let next = t
  while (now - next.phaseStart >= phaseMs(next)) {
    const phaseStart = next.phaseStart + phaseMs(next)
    next =
      next.phase === 'focus'
        ? { ...next, phase: 'break', phaseStart, doneMin: next.doneMin + next.focusMin }
        : { ...next, phase: 'focus', phaseStart, round: next.round + 1 }
  }
  return next
}

function beep() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.2, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8)
    osc.connect(gain).connect(ctx.destination)
    osc.onended = () => ctx.close()
    osc.start()
    osc.stop(ctx.currentTime + 0.8)
  } catch {
    // 소리를 낼 수 없는 환경이면 화면 표시만
  }
}

function notifyPhase(t) {
  beep()
  const body =
    t.phase === 'break' ? `집중 ${t.focusMin}분 완료! ${t.breakMin}분 쉬어 가세요.` : `휴식 끝! ${t.round}번째 집중을 시작해요.`
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification('스터디로그 뽀모도로', { body })
    }
  } catch {
    // 알림을 지원하지 않는 브라우저
  }
}

export default function RecordPanel({ subjects, onSaved, goToSubjects }) {
  // 스톱워치 { startedAt, subjectId } 또는 뽀모도로 { mode: 'pomodoro', subjectId, phase, phaseStart, ... } — 새로고침해도 유지
  const [timer, setTimer] = useState(loadTimer)
  const [mode, setMode] = useState(() => loadTimer()?.mode ?? 'stopwatch')
  const [focusMin, setFocusMin] = useState(25)
  const [breakMin, setBreakMin] = useState(5)
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
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (timer.mode !== 'pomodoro') return
      const next = advance(timer, t)
      if (next !== timer) {
        saveTimer(next)
        setTimer(next)
        notifyPhase(next)
      }
    }, 1000)
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
    const at = Date.now()
    const next =
      mode === 'pomodoro'
        ? { mode, subjectId: selectedId, focusMin, breakMin, phase: 'focus', phaseStart: at, doneMin: 0, round: 1 }
        : { startedAt: at, subjectId: selectedId }
    if (mode === 'pomodoro' && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    saveTimer(next)
    setTimer(next)
    setNow(at)
    setMessage(null)
  }

  // 지금 구간을 끝내고 다음 구간으로 (집중 중이면 지금까지 집중한 분만 인정)
  function skipPhase() {
    const at = Date.now()
    const next =
      timer.phase === 'focus'
        ? { ...timer, phase: 'break', phaseStart: at, doneMin: timer.doneMin + Math.floor((at - timer.phaseStart) / 60000) }
        : { ...timer, phase: 'focus', phaseStart: at, round: timer.round + 1 }
    saveTimer(next)
    setTimer(next)
    setNow(at)
  }

  function stopTimer() {
    const at = Date.now()
    let total
    if (timer.mode === 'pomodoro') {
      const t = advance(timer, at)
      total = Math.min(1440, t.doneMin + (t.phase === 'focus' ? Math.floor((at - t.phaseStart) / 60000) : 0))
      if (total < 1) {
        cancelTimer()
        setMessage({ type: 'error', text: '집중한 시간이 1분 미만이라 기록할 시간이 없어요.' })
        return
      }
    } else {
      total = Math.min(1440, Math.max(1, Math.round((at - timer.startedAt) / 60000)))
    }
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

      {!timer && (
        <div className="segmented small timer-mode">
          <button className={mode === 'stopwatch' ? 'active' : ''} onClick={() => setMode('stopwatch')}>
            ⏱ 스톱워치
          </button>
          <button className={mode === 'pomodoro' ? 'active' : ''} onClick={() => setMode('pomodoro')}>
            🍅 뽀모도로
          </button>
        </div>
      )}

      <div className={timer ? `timer running ${timer.phase === 'break' ? 'resting' : ''}` : 'timer'}>
        {timer?.mode === 'pomodoro' ? (
          <>
            <div className="timer-phase">{timer.phase === 'focus' ? `🍅 ${timer.round}번째 집중` : '☕ 휴식 시간'}</div>
            <div className="timer-clock">{countdown(phaseMs(timer) - (now - timer.phaseStart))}</div>
            <div className="timer-sub">
              {timerSubject ? `${timerSubject.name} · ` : ''}누적 집중{' '}
              {fmtMinutes(timer.doneMin + (timer.phase === 'focus' ? Math.floor((now - timer.phaseStart) / 60000) : 0))}
            </div>
          </>
        ) : (
          <>
            <div className="timer-clock">
              {!timer && mode === 'pomodoro' ? countdown(focusMin * 60000) : clock(timer ? now - timer.startedAt : 0)}
            </div>
            <div className="timer-sub">
              {timer
                ? timerSubject
                  ? `${timerSubject.name} 공부 중`
                  : '측정 중'
                : mode === 'pomodoro'
                  ? '집중과 휴식을 반복하고, 집중한 시간만 기록돼요'
                  : '타이머로 측정하거나 아래에 직접 입력하세요'}
            </div>
          </>
        )}
        {!timer && mode === 'pomodoro' && (
          <div className="row pomodoro-settings">
            <label>
              집중
              <select value={focusMin} onChange={(e) => setFocusMin(Number(e.target.value))}>
                {POMODORO.focus.map((m) => (
                  <option key={m} value={m}>
                    {m}분
                  </option>
                ))}
              </select>
            </label>
            <label>
              휴식
              <select value={breakMin} onChange={(e) => setBreakMin(Number(e.target.value))}>
                {POMODORO.rest.map((m) => (
                  <option key={m} value={m}>
                    {m}분
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="row">
          {timer ? (
            <>
              <button className="btn primary" onClick={stopTimer}>
                {timer.mode === 'pomodoro' ? '끝내고 기록' : '정지'}
              </button>
              {timer.mode === 'pomodoro' && (
                <button className="btn ghost" onClick={skipPhase}>
                  {timer.phase === 'focus' ? '휴식하기' : '바로 집중'}
                </button>
              )}
              <button className="btn ghost" onClick={cancelTimer}>
                취소
              </button>
            </>
          ) : (
            <button className="btn primary" onClick={startTimer}>
              ▶ {mode === 'pomodoro' ? '뽀모도로 시작' : '타이머 시작'}
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
