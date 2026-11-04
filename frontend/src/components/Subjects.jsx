import { useState } from 'react'
import { api } from '../api.js'
import { CATEGORY, SUBJECT_COLORS } from '../utils.js'

const SUGGESTIONS = {
  general: ['영어', '수학', '자격증', '독서'],
  dev: ['알고리즘', 'React', 'FastAPI', 'CS 기초'],
}

export default function Subjects({ subjects, onChanged }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState('dev')
  const [color, setColor] = useState(SUBJECT_COLORS[0])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/api/subjects', { method: 'POST', body: { name: name.trim(), category, color } })
      await onChanged()
      setName('')
      setColor(SUBJECT_COLORS[(SUBJECT_COLORS.indexOf(color) + 1) % SUBJECT_COLORS.length])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(subject) {
    if (!confirm(`'${subject.name}' 과목을 삭제할까요?\n이미 저장된 공부 기록은 그대로 남아요.`)) return
    setError('')
    try {
      await api(`/api/subjects/${subject.id}`, { method: 'DELETE' })
      await onChanged()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="grid">
      <section className="card">
        <h2>과목 추가</h2>
        <form className="form" onSubmit={add}>
          <div className="segmented">
            {Object.entries(CATEGORY).map(([key, cat]) => (
              <button key={key} type="button" className={category === key ? 'active' : ''} onClick={() => setCategory(key)}>
                {cat.label}
              </button>
            ))}
          </div>
          <label>
            과목 이름
            <input required maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="suggestions">
            {SUGGESTIONS[category].map((s) => (
              <button key={s} type="button" className="chip" onClick={() => setName(s)}>
                {s}
              </button>
            ))}
          </div>
          <div>
            <span className="label">색상</span>
            <div className="swatches">
              {SUBJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={c === color ? 'swatch active' : 'swatch'}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`색상 ${c}`}
                />
              ))}
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={busy}>
            {busy ? '추가 중…' : '추가'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>내 과목</h2>
        {subjects.length === 0 && <p className="muted">아직 과목이 없어요. 왼쪽에서 추가해 보세요.</p>}
        {Object.entries(CATEGORY).map(([key, cat]) => {
          const items = subjects.filter((s) => s.category === key)
          if (!items.length) return null
          return (
            <div key={key} className="subject-group">
              <h3>
                <span className="dot" style={{ background: cat.color }} />
                {cat.label} <span className="muted">{items.length}</span>
              </h3>
              <ul className="list">
                {items.map((s) => (
                  <li key={s.id}>
                    <span className="dot" style={{ background: s.color }} />
                    <span className="grow">{s.name}</span>
                    <button className="btn ghost small" onClick={() => remove(s)}>
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </section>
    </div>
  )
}
