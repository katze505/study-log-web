export const HISTORY_DAYS = 84 // 12주 잔디 + 차트용

export const CATEGORY = {
  general: { label: '일반 공부', color: '#6366f1' },
  dev: { label: '개발 스터디', color: '#10b981' },
}

export const SUBJECT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#10b981', '#06b6d4', '#64748b']

export function today() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

// 사용자 로컬 기준 YYYY-MM-DD
export function toISO(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

export function fmtMinutes(total) {
  const h = Math.floor(total / 60)
  const m = total % 60
  if (!h) return `${m}분`
  return m ? `${h}시간 ${m}분` : `${h}시간`
}

export function sumBy(items, key) {
  const out = {}
  for (const item of items) out[item[key]] = (out[item[key]] || 0) + item.duration_minutes
  return out
}
