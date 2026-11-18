import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { CATEGORY, fmtMinutes, monthRange, sumBy, toISO, today } from '../utils.js'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

// 기록 탭은 최근 기록만 보여 주므로, 30일보다 오래된 기록은 여기서 월 단위로 조회
export default function History({ subjects, onChanged }) {
  const now = today()
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [version, setVersion] = useState(0)

  const maxKey = monthKey(now.getFullYear(), now.getMonth())
  const key = monthKey(ym.year, ym.month)

  useEffect(() => {
    let cancelled = false
    const { start, end } = monthRange(ym.year, ym.month)
    api(`/api/sessions?start=${toISO(start)}&end=${toISO(end)}`)
      .then((result) => {
        if (cancelled) return
        setRows(result)
        setError('')
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [ym, version])

  function move(delta) {
    const d = new Date(ym.year, ym.month + delta, 1)
    setRows(null)
    setYm({ year: d.getFullYear(), month: d.getMonth() })
  }

  function pick(value) {
    if (!value) return
    const [y, m] = value.split('-').map(Number)
    setRows(null)
    setYm({ year: y, month: m - 1 })
  }

  async function remove(id) {
    if (!confirm('이 기록을 삭제할까요?')) return
    setDeleting(id)
    setError('')
    try {
      await api(`/api/sessions/${id}`, { method: 'DELETE' })
      setVersion((v) => v + 1)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(null)
    }
  }

  const colorOf = Object.fromEntries(subjects.map((s) => [s.id, s.color]))
  const total = rows ? rows.reduce((a, s) => a + s.duration_minutes, 0) : 0
  const byCategory = rows ? sumBy(rows, 'category') : {}
  const bySubject = rows ? Object.entries(sumBy(rows, 'subject_name')).sort((a, b) => b[1] - a[1]) : []
  const days = rows ? [...new Set(rows.map((r) => r.studied_on))] : []

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <h2>지난 기록</h2>
          <div className="month-nav">
            <button className="btn ghost small" onClick={() => move(-1)} aria-label="이전 달">
              ‹
            </button>
            <input type="month" value={key} max={maxKey} onChange={(e) => pick(e.target.value)} aria-label="조회할 달" />
            <button className="btn ghost small" onClick={() => move(1)} disabled={key >= maxKey} aria-label="다음 달">
              ›
            </button>
          </div>
        </div>
        <p className="hint">‹ › 버튼이나 달 선택으로 30일보다 오래된 기록도 월별로 모두 볼 수 있어요.</p>

        {error && <p className="error">{error}</p>}
        {!rows ? (
          !error && <p className="muted">불러오는 중…</p>
        ) : (
          <>
            <div className="stats history-stats">
              <div className="stat">
                <span className="muted">{ym.month + 1}월 합계</span>
                <strong>{fmtMinutes(total)}</strong>
              </div>
              <div className="stat">
                <span className="muted">공부한 날</span>
                <strong>{days.length}일</strong>
              </div>
              <div className="stat">
                <span className="muted">하루 평균</span>
                <strong>{fmtMinutes(days.length ? Math.round(total / days.length) : 0)}</strong>
              </div>
            </div>
            {total > 0 && (
              <>
                <div className="split">
                  {Object.entries(CATEGORY).map(([k, cat]) => (
                    <div key={k} className="split-item">
                      <span className="dot" style={{ background: cat.color }} />
                      {cat.label}
                      <strong>{fmtMinutes(byCategory[k] || 0)}</strong>
                    </div>
                  ))}
                </div>
                <div className="suggestions history-subjects">
                  {bySubject.map(([name, minutes]) => (
                    <span key={name} className="chip static">
                      {name} · {fmtMinutes(minutes)}
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>

      {rows && (
        <section className="card">
          <h2>날짜별 기록</h2>
          {rows.length === 0 ? (
            <p className="muted">이 달에는 기록이 없어요.</p>
          ) : (
            days.map((day) => {
              const items = rows.filter((r) => r.studied_on === day)
              const d = new Date(`${day}T00:00:00`)
              return (
                <div key={day} className="day-group">
                  <h3>
                    {d.getMonth() + 1}/{d.getDate()} ({WEEKDAYS[d.getDay()]})
                    <span className="muted">{fmtMinutes(items.reduce((a, s) => a + s.duration_minutes, 0))}</span>
                  </h3>
                  <ul className="list">
                    {items.map((s) => (
                      <li key={s.id}>
                        <span className="dot" style={{ background: colorOf[s.subject_id] ?? '#94a3b8' }} />
                        <span className="grow">
                          {s.subject_name}
                          <span className={`badge ${s.category}`}>{CATEGORY[s.category].label}</span>
                          {s.memo && <span className="muted memo"> · {s.memo}</span>}
                        </span>
                        <span className="nowrap">{fmtMinutes(s.duration_minutes)}</span>
                        <button
                          className="btn ghost small"
                          disabled={deleting === s.id}
                          onClick={() => remove(s.id)}
                          aria-label="기록 삭제"
                        >
                          삭제
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })
          )}
        </section>
      )}
    </div>
  )
}
