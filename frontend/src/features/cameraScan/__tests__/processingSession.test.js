import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { api } = vi.hoisted(() => ({ api: { cameraProcessingSession: vi.fn() } }))
vi.mock('../../../api/client', () => ({ api }))

import { PROCESSING_SESSION_ERROR, processingSessionNeedsRefresh, useProcessingSession } from '../hooks/useProcessingSession'

const participant = { id: 'participant-a', participant_access_token: 'memory-token' }
const created = (token, expiresAt = Math.floor(Date.now() / 1000) + 300) => ({ session_token: token, expires_at: expiresAt })

beforeEach(() => { vi.clearAllMocks(); api.cameraProcessingSession.mockResolvedValue(created('session-a')) })
afterEach(() => vi.clearAllMocks())

it('uses epoch seconds and refreshes only a near-expiry session without observations', () => {
  const now = 2_000
  expect(processingSessionNeedsRefresh(created('fresh', now + 91), 0, now)).toBe(false)
  expect(processingSessionNeedsRefresh(created('near', now + 89), 0, now)).toBe(true)
  expect(processingSessionNeedsRefresh(created('bound', now + 20), 1, now)).toBe(false)
})

it('does not create a processor session until an operation needs one', async () => {
  const { result } = renderHook(() => useProcessingSession({ participant, heightMm: 1800 }))
  expect(api.cameraProcessingSession).not.toHaveBeenCalled()
  await act(async () => {
    await result.current.withValidProcessingSession((session) => Promise.resolve(session.session_token))
  })
  expect(api.cameraProcessingSession).toHaveBeenCalledOnce()
})

it('replaces an expired token and retries the operation exactly once before any observation exists', async () => {
  api.cameraProcessingSession.mockResolvedValueOnce(created('expired')).mockResolvedValueOnce(created('replacement'))
  const operation = vi.fn()
    .mockRejectedValueOnce(Object.assign(new Error('expired'), { code: 'TOKEN_EXPIRED', status: 401 }))
    .mockResolvedValueOnce('accepted')
  const { result } = renderHook(() => useProcessingSession({ participant, heightMm: 1800 }))
  let value
  await act(async () => { value = await result.current.withValidProcessingSession(operation, { acceptedObservationCount: 0 }) })
  expect(value).toBe('accepted')
  expect(operation).toHaveBeenCalledTimes(2)
  expect(api.cameraProcessingSession).toHaveBeenCalledTimes(2)
  expect(operation.mock.calls.map(([session]) => session.session_token)).toEqual(['expired', 'replacement'])
})

it('clears session-bound observations and requires restart after expiry without repeating legal consent', async () => {
  const onObservationsExpired = vi.fn(); const onConsentRequired = vi.fn()
  const operation = vi.fn().mockRejectedValue(Object.assign(new Error('expired'), { code: 'TOKEN_EXPIRED', status: 401 }))
  const { result } = renderHook(() => useProcessingSession({ participant, heightMm: 1800, onObservationsExpired, onConsentRequired }))
  await act(async () => {
    await result.current.ensureValidProcessingSession({ acceptedObservationCount: 0 })
    await expect(result.current.withValidProcessingSession(operation, { acceptedObservationCount: 1 })).rejects.toMatchObject({ code: PROCESSING_SESSION_ERROR.EXPIRED_WITH_OBSERVATIONS })
  })
  expect(operation).toHaveBeenCalledOnce()
  expect(api.cameraProcessingSession).toHaveBeenCalledOnce()
  expect(onObservationsExpired).toHaveBeenCalledOnce()
  expect(onConsentRequired).not.toHaveBeenCalled()
})

it('reports actual consent errors separately from token expiry', async () => {
  const onConsentRequired = vi.fn()
  const consentError = Object.assign(new Error('consent'), { code: 'CAMERA_PROCESSING_CONSENT_REQUIRED', status: 403 })
  const { result } = renderHook(() => useProcessingSession({ participant, heightMm: 1800, onConsentRequired }))
  await act(async () => {
    await expect(result.current.withValidProcessingSession(() => Promise.reject(consentError))).rejects.toBe(consentError)
  })
  expect(onConsentRequired).toHaveBeenCalledWith(consentError)
  expect(api.cameraProcessingSession).toHaveBeenCalledOnce()
})

it('does not mistake an expired participant credential for an expired processor session', async () => {
  const onConsentRequired = vi.fn(); const operation = vi.fn()
  api.cameraProcessingSession.mockRejectedValue(Object.assign(new Error('expired participant'), { code: 'TOKEN_EXPIRED', status: 401 }))
  const { result } = renderHook(() => useProcessingSession({ participant, heightMm: 1800, onConsentRequired }))
  await act(async () => {
    await expect(result.current.withValidProcessingSession(operation)).rejects.toMatchObject({ code: 'PARTICIPANT_ACCESS_REQUIRED' })
  })
  expect(api.cameraProcessingSession).toHaveBeenCalledOnce()
  expect(operation).not.toHaveBeenCalled()
  expect(onConsentRequired).toHaveBeenCalledWith(expect.objectContaining({ code: 'PARTICIPANT_ACCESS_REQUIRED' }))
})
