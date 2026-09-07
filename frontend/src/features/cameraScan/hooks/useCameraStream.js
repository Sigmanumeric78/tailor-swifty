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
  for (let index = 0; index < count; index += 1) {
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(video, 0, 0)
    const bitmap = await createImageBitmap(canvas); context.clearRect(0, 0, canvas.width, canvas.height)
    frames.push({ id: crypto.randomUUID(), timestamp: performance.now(), bitmap, width: canvas.width, height: canvas.height, qualityScore: 1 })
    if (index + 1 < count) await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return frames
}

export function releaseFrames(frames = []) { frames.forEach((frame) => frame.bitmap?.close?.()) }
