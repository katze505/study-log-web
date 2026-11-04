import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CATEGORY, addDays, fmtMinutes, sumBy, toISO, today } from '../utils.js'

const FALLBACK_COLOR = '#94a3b8'

export function TrendChart({ sessions, subjects }) {
  const [range, setRange] = useState(7)
  const end = today()
  const startISO = toISO(addDays(end, -(range - 1)))
  const inRange = sessions.filter((s) => s.studied_on >= startISO)

  const byDay = {}
  for (const s of inRange) {
    byDay[s.studied_on] ??= { general: 0, dev: 0 }
    byDay[s.studied_on][s.category] += s.duration_minutes
  }
  const days = Array.from({ length: range }, (_, i) => {
    const d = addDays(end, i - (range - 1))
    const iso = toISO(d)
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, general: 0, dev: 0, ...byDay[iso] }
  })

  const colorOf = Object.fromEntries(subjects.map((s) => [s.id, s.color]))
  const bySubject = {}
  for (const s of inRange) {
    const key = s.subject_id ?? `deleted:${s.subject_name}`
    bySubject[key] ??= { name: s.subject_name, color: colorOf[s.subject_id] ?? FALLBACK_COLOR, value: 0 }
    bySubject[key].value += s.duration_minutes
  }
  const pie = Object.values(bySubject).sort((a, b) => b.value - a.value)
  const total = pie.reduce((acc, p) => acc + p.value, 0)
  const byCategory = sumBy(inRange, 'category')

  return (
    <section className="card">
      <div className="card-head">
        <h2>공부 시간 추이</h2>
        <div className="segmented small">
          {[7, 30].map((r) => (
            <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>
              {r}일
            </button>
          ))}
        </div>
      </div>

      <div className="chart">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={days} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} interval={range > 7 ? 4 : 0} />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--muted)' }}
              tickFormatter={(v) => `${Math.round((v / 60) * 10) / 10}h`}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: 'var(--hover)' }}
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
              formatter={(v, key) => [fmtMinutes(v), CATEGORY[key].label]}
            />
            <Bar dataKey="general" stackId="a" fill={CATEGORY.general.color} />
            <Bar dataKey="dev" stackId="a" fill={CATEGORY.dev.color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="split">
        {Object.entries(CATEGORY).map(([key, cat]) => (
          <div key={key} className="split-item">
            <span className="dot" style={{ background: cat.color }} />
            {cat.label}
            <strong>{fmtMinutes(byCategory[key] || 0)}</strong>
          </div>
        ))}
      </div>
      {total > 0 && (
        <div className="split-bar">
          {Object.entries(CATEGORY).map(([key, cat]) => (
            <span key={key} style={{ width: `${((byCategory[key] || 0) / total) * 100}%`, background: cat.color }} />
          ))}
        </div>
      )}

      <h3>과목별 비중</h3>
      {total === 0 ? (
        <p className="muted">이 기간에는 기록이 없어요.</p>
      ) : (
        <div className="donut-wrap">
          <ResponsiveContainer width={150} height={150}>
            <PieChart>
              <Pie data={pie} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2} stroke="none">
                {pie.map((p) => (
                  <Cell key={p.name} fill={p.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <ul className="legend">
            {pie.map((p) => (
              <li key={p.name}>
                <span className="dot" style={{ background: p.color }} />
                <span className="grow">{p.name}</span>
                <span className="muted">{Math.round((p.value / total) * 100)}%</span>
                <strong>{fmtMinutes(p.value)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function level(minutes) {
  if (!minutes) return 0
  if (minutes < 30) return 1
  if (minutes < 60) return 2
  if (minutes < 120) return 3
  return 4
}

export function Heatmap({ sessions }) {
  const end = today()
  const start = addDays(end, -(7 * 11 + end.getDay())) // 12주, 일요일 시작
  const byDay = sumBy(sessions, 'studied_on')
  const weeks = Array.from({ length: 12 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d)
      const iso = toISO(date)
      return { iso, future: date > end, minutes: byDay[iso] || 0 }
    }),
  )

  return (
    <section className="card">
      <div className="card-head">
        <h2>최근 12주 잔디</h2>
        <div className="heat-legend">
          적음
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={`cell l${l}`} />
          ))}
          많음
        </div>
      </div>
      <div className="heatmap">
        {weeks.map((week) => (
          <div key={week[0].iso} className="heat-col">
            {week.map((c) => (
              <span
                key={c.iso}
                className={c.future ? 'cell future' : `cell l${level(c.minutes)}`}
                title={c.future ? '' : `${c.iso} · ${fmtMinutes(c.minutes)}`}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
