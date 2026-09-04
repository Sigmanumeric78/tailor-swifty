const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')


function resolveApiUrl(path) {
  return `${API_BASE_URL}${path}`
}


export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || 'The local service could not complete the request.')
    this.status = status
    this.code = payload?.error?.code || 'API_ERROR'
    this.details = payload?.error?.details || []
  }
}

export async function request(path, options = {}) {
  const response = await fetch(resolveApiUrl(path), {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(response.status, payload)
  return payload
}

export const api = {
  schema: () => request('/api/v1/measurement-schema?garments=shirt'),
  participant: () => request('/api/v1/participants', { method: 'POST', body: '{}' }),
  consent: (participantId) => request('/api/v1/consents/start', {
    method: 'POST',
    body: JSON.stringify({ participant_id: participantId, purpose: 'generate_outfit_recommendation', granted: true }),
  }),
  session: (payload) => request('/api/v1/measurement-sessions', { method: 'POST', body: JSON.stringify(payload) }),
  measurements: (sessionId, measurements) => request(`/api/v1/measurement-sessions/${sessionId}/measurements`, {
    method: 'POST', body: JSON.stringify({ measurements }),
  }),
  validate: (sessionId) => request(`/api/v1/measurement-sessions/${sessionId}/validate`, { method: 'POST' }),
  submit: (sessionId, key) => request(`/api/v1/measurement-sessions/${sessionId}/submit`, {
    method: 'POST', headers: { 'Idempotency-Key': key },
  }),
  recommend: (payload, key) => request('/api/v1/recommendations', {
    method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(payload),
  }),
  recommendation: (id) => request(`/api/v1/recommendations/${id}`),
}
