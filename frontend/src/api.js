const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
const SESSION_KEY = 'studylog.session'

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY))
  } catch {
    return null
  }
}

export function setSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // 저장소를 쓸 수 없는 환경에서는 새로고침 시 다시 로그인
  }
}

export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

let refreshing = null

function refreshSession() {
  const session = getSession()
  if (!session?.refresh_token) return Promise.resolve(null)
  refreshing ??= fetch(`${API_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  })
    .then(async (res) => {
      const next = res.ok ? await res.json() : null
      setSession(next)
      return next
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

export async function api(path, { method = 'GET', body, auth = true } = {}, retry = true) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const session = getSession()
  if (auth && session) headers.Authorization = `Bearer ${session.access_token}`

  let res
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  }

  if (res.status === 401 && auth && session) {
    if (retry && (await refreshSession())) return api(path, { method, body, auth }, false)
    window.dispatchEvent(new Event('studylog:logout'))
  }

  if (!res.ok) {
    let message = '요청에 실패했습니다.'
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (Array.isArray(data.detail)) message = '입력값을 다시 확인해 주세요.'
    } catch {
      // 본문이 JSON이 아니면 기본 메시지 사용
    }
    throw new ApiError(res.status, message)
  }
  return res.status === 204 ? null : res.json()
}
