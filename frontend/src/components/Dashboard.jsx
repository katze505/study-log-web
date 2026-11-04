import { useState } from 'react'
import { api } from '../api.js'
import { CATEGORY, addDays, fmtMinutes, sumBy, toISO, today } from '../utils.js'
import { Heatmap, TrendChart } from './Charts.jsx'
import RecordPanel from './RecordPanel.jsx'

function streak(byDay) {
  let d = today()
  if (!byDay[toISO(d)]) d = addDays(d, -1) // 오늘 아직 안 했으면 어제부터 계산
  let count = 0
  while (byDay[toISO(d)]) {
    count += 1
    d = addDays(d, -1)
  }
  return count
}

export default function Dashboard({ subjects, sessions, onChanged, goToSubjects }) {
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState('')

  const byDay = sumBy(sessions, 'studied_on')
  const todayISO = toISO(today())
  const weekStart = toISO(addDays(today(), -6))
  const weekTotal = sessions.filter((s) => s.studied_on >= weekStart).reduce((a, s) => a + s.duration_minutes, 0)
  const colorOf = Object.fromEntries(subjects.map((s) => [s.id, s.color]))

  async function remove(id) {
    if (!confirm('이 기록을 삭제할까요?')) return
    setDeleting(id)
    setError('')
    try {
      await api(`/api/sessions/${id}`, { method: 'DELETE' })
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="dashboard">
      <div className="stats">
        <div className="stat">
          <span className="muted">오늘</span>
          <strong>{fmtMinutes(byDay[todayISO] || 0)}</strong>
        </div>
        <div className="stat">
          <span className="muted">최근 7일</span>
          <strong>{fmtMinutes(weekTotal)}</strong>
        </div>
        <div className="stat">
          <span className="muted">연속 기록</span>
          <strong>{streak(byDay)}일</strong>
        </div>
      </div>

      <div className="grid">
        <RecordPanel subjects={subjects} onSaved={onChanged} goToSubjects={goToSubjects} />
        <TrendChart sessions={sessions} subjects={subjects} />
      </div>

      <Heatmap sessions={sessions} />

      <section className="card">
        <h2>최근 기록</h2>
        {error && <p className="error">{error}</p>}
        {sessions.length === 0 ? (
          <p className="muted">아직 기록이 없어요. 첫 공부를 기록해 보세요!</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>과목</th>
                <th>시간</th>
                <th className="hide-sm">메모</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sessions.slice(0, 30).map((s) => (
                <tr key={s.id}>
                  <td className="nowrap">{s.studied_on.slice(5).replace('-', '/')}</td>
                  <td>
                    <span className="dot" style={{ background: colorOf[s.subject_id] ?? '#94a3b8' }} />
                    {s.subject_name}
                    <span className={`badge ${s.category}`}>{CATEGORY[s.category].label}</span>
                  </td>
                  <td className="nowrap">{fmtMinutes(s.duration_minutes)}</td>
                  <td className="hide-sm muted">{s.memo}</td>
                  <td>
                    <button
                      className="btn ghost small"
                      disabled={deleting === s.id}
                      onClick={() => remove(s.id)}
                      aria-label="기록 삭제"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
