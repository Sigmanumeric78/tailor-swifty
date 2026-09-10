const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')


function resolveApiUrl(path) {
  return `${API_BASE_URL}${path}`
}


export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message || 'The service could not complete the request.')
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

function participantHeaders(participantAccessToken) {
  if (!participantAccessToken) {
    throw new ApiError(401, { error: { code: 'PARTICIPANT_ACCESS_REQUIRED', message: 'This anonymous fitting session expired. Start again to continue.' } })
  }
  return { Authorization: `Bearer ${participantAccessToken}` }
}

export const api = {
  schema: () => request('/api/v1/measurement-schema?garments=shirt'),
  participant: () => request('/api/v1/participants', { method: 'POST', body: '{}' }),
  consent: (participantId, participantAccessToken) => request('/api/v1/consents/start', {
    method: 'POST',
    headers: participantHeaders(participantAccessToken),
    body: JSON.stringify({ participant_id: participantId, purpose: 'generate_outfit_recommendation', granted: true }),
  }),
  cameraProcessingConsent: (participantId, participantAccessToken) => request('/api/v1/consents/start', {
    method: 'POST',
    headers: participantHeaders(participantAccessToken),
    body: JSON.stringify({ participant_id: participantId, purpose: 'server_camera_processing', granted: true }),
  }),
  cameraProcessingSession: (participantId, participantAccessToken) => request('/api/v1/camera-processing/session', {
    method: 'POST', headers: participantHeaders(participantAccessToken), body: JSON.stringify({ participant_id: participantId, server_image_processing_consent: true }),
  }),
  session: (payload, participantAccessToken) => request('/api/v1/measurement-sessions', { method: 'POST', headers: participantHeaders(participantAccessToken), body: JSON.stringify(payload) }),
  measurements: (sessionId, measurements, participantAccessToken) => request(`/api/v1/measurement-sessions/${sessionId}/measurements`, {
    method: 'POST', headers: participantHeaders(participantAccessToken), body: JSON.stringify({ measurements }),
  }),
  validate: (sessionId, participantAccessToken) => request(`/api/v1/measurement-sessions/${sessionId}/validate`, { method: 'POST', headers: participantHeaders(participantAccessToken) }),
  submit: (sessionId, key, participantAccessToken) => request(`/api/v1/measurement-sessions/${sessionId}/submit`, {
    method: 'POST', headers: { ...participantHeaders(participantAccessToken), 'Idempotency-Key': key },
  }),
  recommend: (payload, key, participantAccessToken) => request('/api/v1/recommendations', {
    method: 'POST', headers: { ...participantHeaders(participantAccessToken), 'Idempotency-Key': key }, body: JSON.stringify(payload),
  }),
  recommendation: (id, participantAccessToken) => request(`/api/v1/recommendations/${id}`, { headers: participantHeaders(participantAccessToken) }),
}
