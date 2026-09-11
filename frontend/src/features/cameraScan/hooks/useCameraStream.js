import { useCallback, useEffect, useRef, useState } from 'react'
import { scanConfig } from '../scanConfig'

export const CAMERA_STREAM_STATE = Object.freeze({
  IDLE: 'idle',
  REQUESTING_PERMISSION: 'requesting_permission',
  OPENING_STREAM: 'opening_stream',
  ATTACHING_STREAM: 'attaching_stream',
  WAITING_FOR_METADATA: 'waiting_for_metadata',
  WAITING_FOR_FIRST_FRAME: 'waiting_for_first_frame',
  READY: 'ready',
  SWITCHING_CAMERA: 'switching_camera',
  CAPTURING: 'capturing',
  PROCESSING: 'processing',
  RECOVERING: 'recovering',
  PERMISSION_DENIED: 'permission_denied',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
  STOPPED: 'stopped',
})

export const cameraConstraints = {
  audio: false,
  video: { facingMode: { ideal: 'environment' }, width: { ideal: scanConfig.camera.widthIdeal }, height: { ideal: scanConfig.camera.heightIdeal } },
}

export function cameraConstraintLadder(deviceId) {
  const preferred = deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }
  return [
    { ...preferred, width: { ideal: scanConfig.camera.widthIdeal }, height: { ideal: scanConfig.camera.heightIdeal } },
    { ...preferred, width: { ideal: scanConfig.camera.fallbackWidthIdeal }, height: { ideal: scanConfig.camera.fallbackHeightIdeal } },
    deviceId ? preferred : true,
  ]
}

/** Startup-oriented constraints for the server path, whose upload is capped near 1280 px. */
export function serverCameraConstraintLadder({ deviceId = '', facingMode = 'environment' } = {}) {
  const size = { width: { ideal: 1280 }, height: { ideal: 720 } }
  if (deviceId) return [{ deviceId: { exact: deviceId }, ...size }, { deviceId: { exact: deviceId } }]
  return [
    { facingMode: { exact: facingMode }, ...size },
    { facingMode: { ideal: facingMode }, ...size },
    { facingMode: { ideal: facingMode } },
    true,
  ]
}

export function cameraDisplayName(device, index) {
  const label = device.label || ''
  if (/back|rear|environment/i.test(label)) return `Rear camera${label ? ` · ${label}` : ''}`
  if (/front|user|facetime/i.test(label)) return `Front camera${label ? ` · ${label}` : ''}`
  return label || `Camera ${index + 1}`
}

export function stopMediaStream(stream) { stream?.getTracks().forEach((track) => track.stop()) }

const finite = (value) => Number.isFinite(value) ? value : null
const range = (value) => value && typeof value === 'object' ? { min: finite(value.min), max: finite(value.max), step: finite(value.step) } : null

/** Non-identifying, in-memory camera facts. Device labels and user agents are deliberately excluded. */
export function normalizeCameraCapabilities(track) {
  const capabilities = track?.getCapabilities?.() || {}; const settings = track?.getSettings?.() || {}
  return {
    width: finite(settings.width), height: finite(settings.height), frameRate: finite(settings.frameRate), aspectRatio: finite(settings.aspectRatio),
    facingMode: typeof settings.facingMode === 'string' ? settings.facingMode : null,
    resizeMode: typeof settings.resizeMode === 'string' ? settings.resizeMode : null,
    zoomRange: range(capabilities.zoom), zoom: finite(settings.zoom), focusDistanceRange: range(capabilities.focusDistance),
    torchAvailable: Array.isArray(capabilities.torch) ? capabilities.torch.includes(true) : capabilities.torch === true,
  }
}

export async function requestNeutralZoom(track) {
  const capabilities = track?.getCapabilities?.() || {}
  if (!capabilities.zoom || capabilities.zoom.min > 1 || capabilities.zoom.max < 1 || !track.applyConstraints) return false
  try { await track.applyConstraints({ advanced: [{ zoom: 1 }] }); return true } catch { return false }
}

function cameraFailureState(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return CAMERA_STREAM_STATE.PERMISSION_DENIED
  if (error?.code === 'CAMERA_UNAVAILABLE') return CAMERA_STREAM_STATE.UNAVAILABLE
  return CAMERA_STREAM_STATE.ERROR
}

function readinessError(code, message, name = 'Error') {
  const error = new Error(message)
  error.code = code
  error.name = name
  return error
}

/** Wait for metadata and one presented frame. The returned cleanup cancels every pending browser primitive. */
export function waitForCameraFrame(video, { timeoutMs = 10_000, isCurrent = () => true, onState = () => {} } = {}) {
  const started = performance.now()
  let timeoutId = null; let frameId = null; let animationId = null; let settled = false; let metadataHandled = false; let metadataMs = null
  const listeners = []
  let cancelPending = null
  const cleanupResources = () => {
    if (timeoutId != null) clearTimeout(timeoutId)
    if (frameId != null) video.cancelVideoFrameCallback?.(frameId)
    if (animationId != null) cancelAnimationFrame(animationId)
    listeners.splice(0).forEach(([name, listener]) => video.removeEventListener(name, listener))
  }
  const promise = new Promise((resolve, reject) => {
    const fail = (error) => { if (settled) return; settled = true; cleanupResources(); reject(error) }
    cancelPending = () => fail(readinessError('CAMERA_START_CANCELLED', 'Camera startup was cancelled.'))
    const finish = () => {
      if (settled) return
      if (!isCurrent()) return fail(readinessError('CAMERA_START_CANCELLED', 'Camera startup was superseded.'))
      settled = true; cleanupResources()
      resolve({ metadataMs, firstFrameMs: performance.now() - started })
    }
    timeoutId = setTimeout(() => fail(readinessError('CAMERA_START_TIMEOUT', 'No usable video frame arrived within 10 seconds.', 'TimeoutError')), timeoutMs)

    const waitForFirstFrame = () => {
      if (metadataHandled) return
      metadataHandled = true
      metadataMs = performance.now() - started
      if (!isCurrent()) return fail(readinessError('CAMERA_START_CANCELLED', 'Camera startup was superseded.'))
      if (!video.videoWidth || !video.videoHeight) return fail(readinessError('CAMERA_NO_FRAME', 'The camera did not provide a usable video frame.'))
      onState(CAMERA_STREAM_STATE.WAITING_FOR_FIRST_FRAME)
      if (typeof video.requestVideoFrameCallback === 'function') {
        frameId = video.requestVideoFrameCallback(() => finish())
        return
      }
      const initialTime = Number(video.currentTime) || 0
      const observe = () => {
        if (!isCurrent()) return fail(readinessError('CAMERA_START_CANCELLED', 'Camera startup was superseded.'))
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          // A progressing clock is strongest evidence; a successful paint-frame
          // observation is the standards-compatible fallback on older Safari.
          if ((Number(video.currentTime) || 0) !== initialTime) return finish()
          animationId = requestAnimationFrame(() => finish())
          return
        }
        animationId = requestAnimationFrame(observe)
      }
      animationId = requestAnimationFrame(observe)
    }

    const metadataReady = () => video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0
    if (metadataReady()) return waitForFirstFrame()
    onState(CAMERA_STREAM_STATE.WAITING_FOR_METADATA)
    const listener = () => { if (metadataReady()) waitForFirstFrame() }
    for (const name of ['loadedmetadata', 'canplay']) {
      listeners.push([name, listener]); video.addEventListener(name, listener)
    }
  })
  return { promise, cleanup: () => cancelPending?.() }
}

export function useCameraStream({ startupTimeoutMs = 10_000 } = {}) {
  const streamRef = useRef(null); const activeDeviceRef = useRef(null); const attemptRef = useRef(0); const pendingCleanupRef = useRef(null)
  const [stream, setStream] = useState(null); const [devices, setDevices] = useState([]); const [error, setError] = useState(null)
  const [state, setState] = useState(CAMERA_STREAM_STATE.IDLE); const [timings, setTimings] = useState(null)
  const [capabilitySnapshot, setCapabilitySnapshot] = useState(null); const [cameraChangeWarning, setCameraChangeWarning] = useState(null)

  const refreshDevices = useCallback(async () => {
    try {
      const available = await navigator.mediaDevices?.enumerateDevices?.() || []
      setDevices(available.filter((device) => device.kind === 'videoinput'))
    } catch { /* Device labels/listing are optional; capture remains available. */ }
  }, [])

  const releaseCurrent = useCallback(() => {
    pendingCleanupRef.current?.(); pendingCleanupRef.current = null
    stopMediaStream(streamRef.current); streamRef.current = null
    setStream(null); setCapabilitySnapshot(null)
  }, [])

  const stop = useCallback(() => {
    attemptRef.current += 1
    releaseCurrent(); setError(null); setState(CAMERA_STREAM_STATE.STOPPED); setTimings(null)
  }, [releaseCurrent])

  const adopt = useCallback((next) => {
    if (streamRef.current && streamRef.current !== next) stopMediaStream(streamRef.current)
    const track = next?.getVideoTracks?.()[0]; const settings = track?.getSettings?.() || {}; const nextDeviceId = settings.deviceId || null
    if (activeDeviceRef.current && nextDeviceId && activeDeviceRef.current !== nextDeviceId) setCameraChangeWarning('The active camera changed. Retake both views with one camera for comparable scale.')
    if (nextDeviceId) activeDeviceRef.current = nextDeviceId
    streamRef.current = next; setStream(next); setCapabilitySnapshot(normalizeCameraCapabilities(track)); requestNeutralZoom(track)
    refreshDevices()
  }, [refreshDevices])

  const acquire = useCallback(async (constraints, attempt, deadline) => {
    let lastError
    for (const video of constraints) {
      if (attempt !== attemptRef.current) throw readinessError('CAMERA_START_CANCELLED', 'Camera startup was superseded.')
      const remaining = Math.max(1, deadline - performance.now())
      let timeoutId
      const request = navigator.mediaDevices.getUserMedia({ audio: false, video })
      request.then((lateStream) => { if (performance.now() >= deadline) stopMediaStream(lateStream) }).catch(() => {})
      try {
        const next = await Promise.race([
          request,
          new Promise((_, reject) => { timeoutId = setTimeout(() => reject(readinessError('CAMERA_START_TIMEOUT', 'Camera startup timed out. Retry the camera or use existing photos.', 'TimeoutError')), remaining) }),
        ])
        clearTimeout(timeoutId)
        if (attempt !== attemptRef.current) { stopMediaStream(next); throw readinessError('CAMERA_START_CANCELLED', 'Camera startup was superseded.') }
        return next
      } catch (caught) {
        clearTimeout(timeoutId); lastError = caught
        if (caught.code === 'CAMERA_START_CANCELLED' || caught.code === 'CAMERA_START_TIMEOUT' || caught.name === 'NotAllowedError' || caught.name === 'SecurityError') throw caught
      }
    }
    throw lastError
  }, [])

  /** Backward-compatible stream acquisition for the browser-research route. */
  const start = useCallback(async (deviceId) => {
    const attempt = ++attemptRef.current; releaseCurrent(); setError(null); setState(CAMERA_STREAM_STATE.REQUESTING_PERMISSION)
    if (globalThis.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
      const unavailable = readinessError('CAMERA_UNAVAILABLE', 'Camera access requires a secure browser context with MediaDevices support.')
      setError(unavailable); setState(CAMERA_STREAM_STATE.UNAVAILABLE); throw unavailable
    }
    const started = performance.now()
    try {
      const next = await acquire(cameraConstraintLadder(deviceId), attempt, started + startupTimeoutMs)
      adopt(next); setState(CAMERA_STREAM_STATE.OPENING_STREAM)
      return next
    } catch (caught) {
      if (attempt === attemptRef.current) { releaseCurrent(); setError(caught); setState(cameraFailureState(caught)) }
      throw caught
    }
  }, [acquire, adopt, releaseCurrent, startupTimeoutMs])

  const startReady = useCallback(async (video, selection = {}) => {
    const attempt = ++attemptRef.current; const switching = Boolean(streamRef.current)
    releaseCurrent(); setError(null); setTimings(null); setState(switching ? CAMERA_STREAM_STATE.SWITCHING_CAMERA : CAMERA_STREAM_STATE.REQUESTING_PERMISSION)
    if (!video) {
      const unavailable = readinessError('CAMERA_UNAVAILABLE', 'The camera preview is unavailable.')
      setError(unavailable); setState(CAMERA_STREAM_STATE.UNAVAILABLE); throw unavailable
    }
    if (globalThis.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
      const unavailable = readinessError('CAMERA_UNAVAILABLE', 'Camera access requires HTTPS and browser camera support.')
      setError(unavailable); setState(CAMERA_STREAM_STATE.UNAVAILABLE); throw unavailable
    }
    const started = performance.now(); const deadline = started + startupTimeoutMs
    try {
      setState(CAMERA_STREAM_STATE.OPENING_STREAM)
      const next = await acquire(serverCameraConstraintLadder(selection), attempt, deadline)
      const acquiredMs = performance.now() - started
      if (attempt !== attemptRef.current) { stopMediaStream(next); throw readinessError('CAMERA_START_CANCELLED', 'Camera startup was superseded.') }
      adopt(next); setState(CAMERA_STREAM_STATE.ATTACHING_STREAM); video.srcObject = next
      let playTimeoutId
      try {
        await Promise.race([
          video.play(),
          new Promise((_, reject) => {
            playTimeoutId = setTimeout(
              () => reject(readinessError('CAMERA_START_TIMEOUT', 'The camera preview did not start within 10 seconds. Retry camera access.', 'TimeoutError')),
              Math.max(1, deadline - performance.now()),
            )
          }),
        ])
      } catch (caught) {
        if (caught?.code === 'CAMERA_START_TIMEOUT') throw caught
        throw readinessError('CAMERA_PLAY_FAILED', 'The browser could not start the camera preview. Retry camera access.', caught?.name)
      } finally { clearTimeout(playTimeoutId) }
      const waiter = waitForCameraFrame(video, {
        timeoutMs: Math.max(1, deadline - performance.now()),
        isCurrent: () => attempt === attemptRef.current,
        onState: setState,
      })
      pendingCleanupRef.current = waiter.cleanup
      const readyTiming = await waiter.promise
      pendingCleanupRef.current = null
      if (attempt !== attemptRef.current) throw readinessError('CAMERA_START_CANCELLED', 'Camera startup was superseded.')
      setTimings({ permission_request_ms: acquiredMs, get_user_media_ms: acquiredMs, video_metadata_ms: readyTiming.metadataMs, first_frame_ms: readyTiming.firstFrameMs })
      setState(CAMERA_STREAM_STATE.READY); await refreshDevices()
      return { stream: next, capabilities: normalizeCameraCapabilities(next.getVideoTracks?.()[0]), timings: readyTiming }
    } catch (caught) {
      if (attempt === attemptRef.current) { releaseCurrent(); setError(caught); setState(cameraFailureState(caught)) }
      throw caught
    }
  }, [acquire, adopt, refreshDevices, releaseCurrent, startupTimeoutMs])

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices?.addEventListener) return undefined
    mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => mediaDevices.removeEventListener('devicechange', refreshDevices)
  }, [refreshDevices])
  useEffect(() => () => {
    // Teardown deliberately avoids React state updates. Incrementing the
    // generation makes every pending startup stale before callbacks/tracks are
    // released, including during StrictMode effect replay.
    attemptRef.current += 1
    pendingCleanupRef.current?.(); pendingCleanupRef.current = null
    stopMediaStream(streamRef.current); streamRef.current = null
  }, [])

  const markCapturing = useCallback(() => setState(CAMERA_STREAM_STATE.CAPTURING), [])
  const markProcessing = useCallback(() => setState(CAMERA_STREAM_STATE.PROCESSING), [])
  const markRecovering = useCallback(() => setState(CAMERA_STREAM_STATE.RECOVERING), [])
  const markReady = useCallback(() => { if (streamRef.current) setState(CAMERA_STREAM_STATE.READY) }, [])

  return {
    stream, devices, error, state, timings, capabilitySnapshot, cameraChangeWarning,
    activeDeviceId: activeDeviceRef.current,
    clearCameraChangeWarning: () => setCameraChangeWarning(null),
    refreshDevices, start, startReady, stop, adopt,
    markCapturing, markProcessing, markRecovering, markReady,
    switchCamera: start,
    switchCameraReady: startReady,
  }
}

export async function captureBurst(video, { count = scanConfig.capture.burstSize, intervalMs = 80 } = {}) {
  const frames = []
  try {
    for (let index = 0; index < count; index += 1) {
      const width = video.videoWidth; const height = video.videoHeight
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      try {
        context.drawImage(video, 0, 0); const bitmap = await createImageBitmap(canvas)
        frames.push({ id: crypto.randomUUID(), timestamp: performance.now(), bitmap, width, height, qualityScore: 1 })
      } finally { context.clearRect(0, 0, width, height); canvas.width = 0; canvas.height = 0 }
      if (index + 1 < count) await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    return frames
  } catch (error) { releaseFrames(frames); throw error }
}

export function releaseFrames(frames = []) {
  frames.forEach((frame) => {
    if (!frame || frame.released) return
    frame.bitmap?.close?.()
    frame.released = true
  })
}
