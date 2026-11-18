export const HISTORY_DAYS = 84 // 12주 잔디 + 차트용

export const CATEGORY = {
  general: { label: '일반 공부', color: '#6366f1' },
  dev: { label: '개발 스터디', color: '#10b981' },
}

export const SUBJECT_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#eab308', '#10b981', '#06b6d4', '#64748b']

export const EMAIL_DOMAINS = ['gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'outlook.com']

// 같은 분류 안에서 팔레트 순서대로 묶고, 같은 색은 이름순 — 색을 바꾸면 자동으로 다시 정렬됨
export function sortSubjects(subjects) {
  const rank = (c) => {
    const i = SUBJECT_COLORS.indexOf(c.toLowerCase())
    return i === -1 ? SUBJECT_COLORS.length : i
  }
  return [...subjects].sort((a, b) => rank(a.color) - rank(b.color) || a.name.localeCompare(b.name, 'ko'))
}

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

export function monthRange(year, month) {
  return { start: new Date(year, month, 1), end: new Date(year, month + 1, 0) }
}
