import { useCallback, useEffect, useRef, useState } from 'react'
import { scanConfig } from '../scanConfig'

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

export function useCameraStream() {
  const streamRef = useRef(null); const activeDeviceRef = useRef(null); const [stream, setStream] = useState(null); const [devices, setDevices] = useState([]); const [error, setError] = useState(null)
  const [capabilitySnapshot, setCapabilitySnapshot] = useState(null); const [cameraChangeWarning, setCameraChangeWarning] = useState(null)
  const stop = useCallback(() => { stopMediaStream(streamRef.current); streamRef.current = null; setStream(null); setCapabilitySnapshot(null) }, [])
  const adopt = useCallback((next) => {
    if (streamRef.current && streamRef.current !== next) stopMediaStream(streamRef.current)
    const track = next?.getVideoTracks?.()[0]; const settings = track?.getSettings?.() || {}; const nextDeviceId = settings.deviceId || null
    if (activeDeviceRef.current && nextDeviceId && activeDeviceRef.current !== nextDeviceId) setCameraChangeWarning('The active camera changed. Retake both views with one camera for comparable scale.')
    if (nextDeviceId) activeDeviceRef.current = nextDeviceId
    streamRef.current = next; setStream(next); setCapabilitySnapshot(normalizeCameraCapabilities(track)); requestNeutralZoom(track)
    navigator.mediaDevices?.enumerateDevices?.().then((available) => setDevices(available.filter((device) => device.kind === 'videoinput'))).catch(() => {})
  }, [])
  const start = useCallback(async (deviceId) => {
    stop(); setError(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is not supported by this browser.')
      let lastError
      for (const video of cameraConstraintLadder(deviceId)) {
        try {
          const next = await navigator.mediaDevices.getUserMedia({ audio: false, video }); adopt(next)
          const available = await navigator.mediaDevices.enumerateDevices?.() || []; setDevices(available.filter((device) => device.kind === 'videoinput'))
          return next
        } catch (caught) { lastError = caught }
      }
      throw lastError
    } catch (caught) { setError(caught); throw caught }
  }, [adopt, stop])
  useEffect(() => stop, [stop])
  return { stream, devices, error, capabilitySnapshot, cameraChangeWarning, clearCameraChangeWarning: () => setCameraChangeWarning(null), start, stop, adopt, switchCamera: start }
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
