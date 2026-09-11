import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAMERA_STREAM_STATE, cameraConstraintLadder, cameraDisplayName, normalizeCameraCapabilities, requestNeutralZoom, serverCameraConstraintLadder, useCameraStream, waitForCameraFrame } from '../hooks/useCameraStream'

function track(settings = { deviceId: 'rear-id', facingMode: 'environment', width: 1280, height: 720 }) {
  return { stop: vi.fn(), getCapabilities: () => ({}), getSettings: () => settings }
}

function stream(videoTrack = track()) {
  return { getTracks: () => [videoTrack], getVideoTracks: () => [videoTrack] }
}

function video({ frameCallback = true } = {}) {
  const listeners = new Map(); let frameHandler = null
  const value = {
    readyState: 0, videoWidth: 0, videoHeight: 0, currentTime: 0, srcObject: null,
    play: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((name, listener) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener) }),
    removeEventListener: vi.fn((name, listener) => listeners.get(name)?.delete(listener)),
    dispatch(name) { listeners.get(name)?.forEach((listener) => listener()) },
    presentFrame() { frameHandler?.() },
  }
  if (frameCallback) {
    value.requestVideoFrameCallback = vi.fn((handler) => { frameHandler = handler; return 7 })
    value.cancelVideoFrameCallback = vi.fn()
  }
  return value
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('phone camera compatibility', () => {
  it('uses ideal-only constraints followed by progressively broader fallbacks', () => {
    const ladder = cameraConstraintLadder('rear-id')
    expect(ladder).toEqual([
      { deviceId: { exact: 'rear-id' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      { deviceId: { exact: 'rear-id' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      { deviceId: { exact: 'rear-id' } },
    ])
    expect(JSON.stringify(ladder)).not.toMatch(/minimum|min\b/)
  })

  it('uses browser-selected video as the final automatic fallback', () => { expect(cameraConstraintLadder('')[2]).toBe(true) })

  it('normalizes only non-identifying capability fields and requests neutral zoom', async () => {
    const applyConstraints = vi.fn(async () => {})
    const track = { getCapabilities: () => ({ zoom: { min: 1, max: 4, step: .1 }, torch: [false, true], deviceId: 'secret' }), getSettings: () => ({ width: 1920, height: 1080, frameRate: 30, facingMode: 'environment', deviceId: 'secret' }), applyConstraints }
    expect(normalizeCameraCapabilities(track)).toMatchObject({ width: 1920, height: 1080, frameRate: 30, facingMode: 'environment', torchAvailable: true })
    expect(normalizeCameraCapabilities(track)).not.toHaveProperty('deviceId')
    await expect(requestNeutralZoom(track)).resolves.toBe(true)
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 1 }] })
  })

  it('labels known front and rear cameras clearly', () => {
    expect(cameraDisplayName({ label: 'Back Camera' }, 0)).toMatch(/^Rear camera/)
    expect(cameraDisplayName({ label: 'FaceTime HD Camera' }, 1)).toMatch(/^Front camera/)
  })

  it('uses 1280 startup constraints with exact, ideal, and general facing fallbacks in server mode', () => {
    expect(serverCameraConstraintLadder({ facingMode: 'environment' })).toEqual([
      { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      { facingMode: { ideal: 'environment' } },
      true,
    ])
    expect(serverCameraConstraintLadder({ deviceId: 'private-id' })).toEqual([
      { deviceId: { exact: 'private-id' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      { deviceId: { exact: 'private-id' } },
    ])
  })

  it('waits for metadata and a presented frame before becoming ready', async () => {
    const preview = video(); const states = []
    const waiting = waitForCameraFrame(preview, { onState: (state) => states.push(state) })
    expect(states).toEqual([CAMERA_STREAM_STATE.WAITING_FOR_METADATA])
    preview.readyState = 1; preview.videoWidth = 1280; preview.videoHeight = 720; preview.dispatch('loadedmetadata')
    expect(states.at(-1)).toBe(CAMERA_STREAM_STATE.WAITING_FOR_FIRST_FRAME)
    let resolved = false; waiting.promise.then(() => { resolved = true })
    await Promise.resolve(); expect(resolved).toBe(false)
    preview.presentFrame(); await expect(waiting.promise).resolves.toMatchObject({ firstFrameMs: expect.any(Number) })
  })

  it('uses an animation-frame readiness fallback when video frame callbacks are unavailable', async () => {
    const callbacks = []; vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { callbacks.push(callback); return callbacks.length })); vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const preview = video({ frameCallback: false }); preview.readyState = 2; preview.videoWidth = 640; preview.videoHeight = 480
    const waiting = waitForCameraFrame(preview)
    callbacks.shift()(); callbacks.shift()()
    await expect(waiting.promise).resolves.toBeDefined()
  })

  it('times out startup, stops the acquired track, and exposes a recoverable error state', async () => {
    vi.useFakeTimers(); const oldTrack = track(); const mediaStream = stream(oldTrack); const preview = video()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(mediaStream), enumerateDevices: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), removeEventListener: vi.fn() } })
    const { result } = renderHook(() => useCameraStream({ startupTimeoutMs: 100 }))
    let pending
    await act(async () => { pending = result.current.startReady(preview); await Promise.resolve() })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'CAMERA_START_TIMEOUT' })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    await rejected
    expect(oldTrack.stop).toHaveBeenCalled()
    expect(result.current.state).toBe(CAMERA_STREAM_STATE.ERROR)
  })

  it('bounds a stalled video play promise and stops its stream', async () => {
    vi.useFakeTimers(); const activeTrack = track(); const preview = video()
    preview.play.mockImplementation(() => new Promise(() => {}))
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream(activeTrack)), enumerateDevices: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), removeEventListener: vi.fn() } })
    const { result } = renderHook(() => useCameraStream({ startupTimeoutMs: 100 }))
    let pending
    await act(async () => { pending = result.current.startReady(preview); await Promise.resolve() })
    const rejected = expect(pending).rejects.toMatchObject({ code: 'CAMERA_START_TIMEOUT' })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    await rejected
    expect(activeTrack.stop).toHaveBeenCalled()
    expect(result.current.state).toBe(CAMERA_STREAM_STATE.ERROR)
  })

  it('classifies permission denial without attempting every constraint fallback', async () => {
    const denied = new DOMException('denied', 'NotAllowedError'); const getUserMedia = vi.fn().mockRejectedValue(denied)
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() } })
    const { result } = renderHook(() => useCameraStream())
    await act(async () => { await expect(result.current.startReady(video())).rejects.toMatchObject({ name: 'NotAllowedError' }) })
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(result.current.state).toBe(CAMERA_STREAM_STATE.PERMISSION_DENIED)
  })

  it('stops the old camera before switching and ignores a stale startup result', async () => {
    const firstTrack = track(); const secondTrack = track({ deviceId: 'front-id', facingMode: 'user', width: 1280, height: 720 })
    const getUserMedia = vi.fn().mockResolvedValueOnce(stream(firstTrack)).mockResolvedValueOnce(stream(secondTrack))
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), removeEventListener: vi.fn() } })
    const { result, unmount } = renderHook(() => useCameraStream())
    const rearVideo = video(); rearVideo.readyState = 1; rearVideo.videoWidth = 1280; rearVideo.videoHeight = 720
    let rear
    await act(async () => { rear = result.current.startReady(rearVideo, { facingMode: 'environment' }); await Promise.resolve() })
    rearVideo.presentFrame(); await act(async () => { await rear })
    const frontVideo = video(); frontVideo.readyState = 1; frontVideo.videoWidth = 1280; frontVideo.videoHeight = 720
    let front
    await act(async () => { front = result.current.switchCameraReady(frontVideo, { facingMode: 'user' }); await Promise.resolve() })
    expect(firstTrack.stop).toHaveBeenCalled()
    expect(result.current.state).toBe(CAMERA_STREAM_STATE.WAITING_FOR_FIRST_FRAME)
    frontVideo.presentFrame(); await act(async () => { await front })
    expect(result.current.state).toBe(CAMERA_STREAM_STATE.READY)
    unmount(); expect(secondTrack.stop).toHaveBeenCalled()
  })

  it('cancels listeners and video callbacks when stopped during readiness', async () => {
    const activeTrack = track(); const preview = video(); preview.readyState = 1; preview.videoWidth = 1280; preview.videoHeight = 720
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue(stream(activeTrack)), enumerateDevices: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), removeEventListener: vi.fn() } })
    const { result } = renderHook(() => useCameraStream())
    let pending
    await act(async () => { pending = result.current.startReady(preview); await Promise.resolve() })
    act(() => result.current.stop())
    preview.presentFrame()
    await expect(pending).rejects.toMatchObject({ code: 'CAMERA_START_CANCELLED' })
    expect(preview.cancelVideoFrameCallback).toHaveBeenCalledWith(7)
    expect(activeTrack.stop).toHaveBeenCalled()
    await waitFor(() => expect(result.current.state).toBe(CAMERA_STREAM_STATE.STOPPED))
  })

  it('does not let a stale startup promise replace a newer selected camera', async () => {
    let resolveFirst
    const staleTrack = track({ deviceId: 'stale', facingMode: 'environment' }); const currentTrack = track({ deviceId: 'current', facingMode: 'user' })
    const getUserMedia = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(stream(currentTrack))
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia, enumerateDevices: vi.fn().mockResolvedValue([]), addEventListener: vi.fn(), removeEventListener: vi.fn() } })
    const { result } = renderHook(() => useCameraStream())
    const staleVideo = video(); const currentVideo = video(); currentVideo.readyState = 1; currentVideo.videoWidth = 1280; currentVideo.videoHeight = 720
    let stale, current
    await act(async () => { stale = result.current.startReady(staleVideo, { facingMode: 'environment' }); await Promise.resolve() })
    const staleRejected = expect(stale).rejects.toMatchObject({ code: 'CAMERA_START_CANCELLED' })
    await act(async () => { current = result.current.startReady(currentVideo, { facingMode: 'user' }); await Promise.resolve() })
    currentVideo.presentFrame(); await act(async () => { await current })
    resolveFirst(stream(staleTrack)); await staleRejected
    expect(staleTrack.stop).toHaveBeenCalled()
    expect(result.current.capabilitySnapshot.facingMode).toBe('user')
    expect(result.current.state).toBe(CAMERA_STREAM_STATE.READY)
  })

  it('refreshes the in-memory camera list on devicechange and removes the listener on unmount', async () => {
    let deviceChange
    const addEventListener = vi.fn((name, listener) => { if (name === 'devicechange') deviceChange = listener })
    const removeEventListener = vi.fn()
    const enumerateDevices = vi.fn()
      .mockResolvedValueOnce([{ kind: 'audioinput', deviceId: 'ignored' }, { kind: 'videoinput', deviceId: 'rear' }])
      .mockResolvedValueOnce([{ kind: 'videoinput', deviceId: 'front' }])
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { enumerateDevices, addEventListener, removeEventListener } })
    const { result, unmount } = renderHook(() => useCameraStream())
    await act(async () => { deviceChange(); await Promise.resolve() })
    expect(result.current.devices).toEqual([{ kind: 'videoinput', deviceId: 'rear' }])
    await act(async () => { deviceChange(); await Promise.resolve() })
    expect(result.current.devices).toEqual([{ kind: 'videoinput', deviceId: 'front' }])
    unmount()
    expect(removeEventListener).toHaveBeenCalledWith('devicechange', deviceChange)
  })
})
