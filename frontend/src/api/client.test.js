import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './client'


const token = 'signed-participant-access-token'


describe('participant access transport', () => {
  let storageSetItem

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    storageSetItem = vi.spyOn(Storage.prototype, 'setItem')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('sends participant access only in Authorization and never persists it', async () => {
    await api.consent('participant-a', token)
    await api.cameraProcessingConsent('participant-a', token)
    await api.cameraProcessingSession('participant-a', token)
    await api.session({ participant_id: 'participant-a' }, token)
    await api.measurements('session-a', [], token)
    await api.validate('session-a', token)
    await api.submit('session-a', 'submit-key', token)
    await api.recommend({ measurement_session_id: 'session-a', preferences: {} }, 'recommend-key', token)
    await api.recommendation('recommendation-a', token)

    for (const [url, options] of fetch.mock.calls) {
      expect(url).not.toContain(token)
      expect(options.headers.Authorization).toBe(`Bearer ${token}`)
      expect(options.body || '').not.toContain(token)
    }
    expect(storageSetItem).not.toHaveBeenCalled()
  })

  it('fails locally instead of sending an unauthenticated participant request', () => {
    expect(() => api.consent('participant-a')).toThrow(/session expired/i)
    expect(fetch).not.toHaveBeenCalled()
  })
})
