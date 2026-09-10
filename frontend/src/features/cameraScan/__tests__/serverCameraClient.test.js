import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('../services/serverImageService', () => ({
  prepareServerImage: vi.fn().mockResolvedValue({ imageBase64: 'temporary-pixels', mimeType: 'image/jpeg', byteSize: 1200, width: 1280, height: 960 }),
}))

import { analyzeServerImage, finalizeServerObservations } from '../services/serverCameraClient'
import { prepareServerImage } from '../services/serverImageService'

const response = (payload) => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })

beforeEach(() => {
  prepareServerImage.mockResolvedValue({ imageBase64: 'temporary-pixels', mimeType: 'image/jpeg', byteSize: 1200, width: 1280, height: 960 })
})

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('sends front and side as separate one-image requests without storage or URLs', async () => {
  const fetch = vi.fn().mockImplementation(() => response({ accepted: true, observation_token: 'observation' })); vi.stubGlobal('fetch', fetch)
  const storage = vi.spyOn(Storage.prototype, 'setItem'); const history = vi.spyOn(window.history, 'pushState')
  await analyzeServerImage({ source: {}, sessionToken: 'session', view: 'FRONT', heightMm: 1800, candidateIndex: 0, processorUrl: 'https://processor.example' })
  await analyzeServerImage({ source: {}, sessionToken: 'session', view: 'SIDE', heightMm: 1800, candidateIndex: 0, processorUrl: 'https://processor.example' })
  expect(fetch).toHaveBeenCalledTimes(2)
  const bodies = fetch.mock.calls.map(([, options]) => JSON.parse(options.body))
  expect(bodies.map((body) => body.view)).toEqual(['FRONT', 'SIDE'])
  expect(bodies.every((body) => Object.keys(body).filter((key) => key === 'image_base64').length === 1)).toBe(true)
  expect(storage).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled()
})

it('uses one bounded request without automatic retry and releases the prepared base64 on failure', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('ambiguous network failure')); vi.stubGlobal('fetch', fetch)
  const prepared = { imageBase64: 'temporary-pixels', mimeType: 'image/jpeg', byteSize: 1200, width: 1280, height: 960 }
  prepareServerImage.mockResolvedValueOnce(prepared)
  await expect(analyzeServerImage({ source: {}, sessionToken: 'session', view: 'FRONT', heightMm: 1800, candidateIndex: 0, processorUrl: 'https://processor.example' })).rejects.toThrow(/ambiguous/)
  expect(fetch).toHaveBeenCalledOnce(); expect(prepared.imageBase64).toBe('')
})

it('finalizes compact observation tokens without image fields', async () => {
  const fetch = vi.fn().mockImplementation(() => response({ measurements: {} })); vi.stubGlobal('fetch', fetch)
  await finalizeServerObservations({ sessionToken: 'session', frontTokens: ['front'], sideTokens: ['side'], processorUrl: 'https://processor.example' })
  const body = JSON.parse(fetch.mock.calls[0][1].body)
  expect(body).toEqual({ session_token: 'session', front_observation_tokens: ['front'], side_observation_tokens: ['side'] })
  expect(JSON.stringify(body)).not.toMatch(/image|base64|blob|landmark|mask/i)
})

it('honours an already-aborted request without retrying', async () => {
  const fetch = vi.fn().mockRejectedValue(new DOMException('cancelled', 'AbortError')); vi.stubGlobal('fetch', fetch)
  const controller = new AbortController(); controller.abort(new DOMException('cancelled', 'AbortError'))
  await expect(analyzeServerImage({ source: {}, sessionToken: 'session', view: 'FRONT', heightMm: 1800, candidateIndex: 0, processorUrl: 'https://processor.example', signal: controller.signal })).rejects.toThrow(/cancelled/)
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true)
})

it('returns a structured timeout without retrying the expensive request', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn((url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))); vi.stubGlobal('fetch', fetch)
  const processing = analyzeServerImage({ source: {}, sessionToken: 'session', view: 'FRONT', heightMm: 1800, candidateIndex: 0, processorUrl: 'https://processor.example' })
  const rejected = expect(processing).rejects.toMatchObject({ code: 'PROCESSING_TIMEOUT' })
  await vi.advanceTimersByTimeAsync(60_000)
  await rejected
  expect(fetch).toHaveBeenCalledOnce()
})
