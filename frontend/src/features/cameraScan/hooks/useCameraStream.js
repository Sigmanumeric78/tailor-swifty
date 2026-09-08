import { useCallback, useEffect, useRef, useState } from 'react'
import { scanConfig } from '../scanConfig'

export const cameraConstraints = {
  audio: false,
  video: { facingMode: { ideal: 'environment' }, width: { ideal: scanConfig.camera.widthIdeal, min: scanConfig.camera.widthMin }, height: { ideal: scanConfig.camera.heightIdeal, min: scanConfig.camera.heightMin } },
}

export function stopMediaStream(stream) { stream?.getTracks().forEach((track) => track.stop()) }

export function useCameraStream() {
  const streamRef = useRef(null); const [stream, setStream] = useState(null); const [devices, setDevices] = useState([]); const [error, setError] = useState(null)
  const stop = useCallback(() => { stopMediaStream(streamRef.current); streamRef.current = null; setStream(null) }, [])
  const adopt = useCallback((next) => {
    streamRef.current = next; setStream(next)
    navigator.mediaDevices?.enumerateDevices?.().then((available) => setDevices(available.filter((device) => device.kind === 'videoinput'))).catch(() => {})
  }, [])
  const start = useCallback(async (deviceId) => {
    stop(); setError(null)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera is not supported by this browser.')
      const constraints = deviceId ? { ...cameraConstraints, video: { ...cameraConstraints.video, deviceId: { exact: deviceId } } } : cameraConstraints
      const next = await navigator.mediaDevices.getUserMedia(constraints); streamRef.current = next; setStream(next)
      const available = await navigator.mediaDevices.enumerateDevices(); setDevices(available.filter((device) => device.kind === 'videoinput'))
      return next
    } catch (caught) { setError(caught); throw caught }
  }, [stop])
  useEffect(() => stop, [stop])
  return { stream, devices, error, start, stop, adopt, switchCamera: start }
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

export function releaseFrames(frames = []) { frames.forEach((frame) => frame.bitmap?.close?.()) }
