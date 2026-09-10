import { serverImageConfig } from '../serverConfig'
import { prepareServerImage } from './serverImageService'

const PROCESSOR_URL = (import.meta.env.VITE_CAMERA_PROCESSOR_URL || '').replace(/\/+$/, '')
const SAFE_METADATA_KEYS = new Set(['width', 'height', 'frame_rate', 'aspect_ratio', 'roll', 'pitch', 'encoded_bytes'])

class RequestLimiter {
  constructor(maximum = 2) { this.maximum = maximum; this.active = 0; this.waiters = [] }
  async enter() {
    if (this.active >= this.maximum) await new Promise((resolve) => this.waiters.push(resolve))
    this.active += 1
  }
  leave() { this.active -= 1; this.waiters.shift()?.() }
}

const limiter = new RequestLimiter(2)

function timedSignal(externalSignal) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new DOMException('Camera processing timed out', 'TimeoutError')), serverImageConfig.requestTimeoutMs)
  const abort = () => controller.abort(externalSignal?.reason)
  externalSignal?.addEventListener('abort', abort, { once: true })
  if (externalSignal?.aborted) abort()
  return { signal: controller.signal, dispose: () => { clearTimeout(timeout); externalSignal?.removeEventListener('abort', abort) } }
}

async function processorRequest(path, payload, signal, processorUrl = PROCESSOR_URL) {
  if (!processorUrl) throw new Error('Camera processing service is not configured.')
  await limiter.enter()
  const timed = timedSignal(signal)
  try {
    let response
    try {
      response = await fetch(`${processorUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: timed.signal })
    } catch (caught) {
      if (!timed.signal.aborted) throw caught
      const error = new Error(signal?.aborted ? 'Camera processing was cancelled.' : 'Camera processing timed out. Retake and submit the photograph again.')
      error.code = signal?.aborted ? 'PROCESSING_ABORTED' : 'PROCESSING_TIMEOUT'
      throw error
    }
    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(result?.error?.message || result?.highest_priority_correction || 'Camera processing failed.')
      error.code = result?.error?.code || 'PROCESSING_FAILED'; error.status = response.status; error.result = result
      throw error
    }
    return result
  } finally { timed.dispose(); limiter.leave() }
}

export async function analyzeServerImage({ source, sessionToken, view, heightMm, candidateIndex, captureMetadata = {}, signal, onProgress = () => {}, onPrepared = () => {}, processorUrl = PROCESSOR_URL }) {
  let prepared = null
  try {
    prepared = await prepareServerImage(source, { onProgress })
    onPrepared({ byteSize: prepared.byteSize, width: prepared.width, height: prepared.height })
    onProgress('Sending encrypted request')
    const safeMetadata = Object.fromEntries(Object.entries(captureMetadata).filter(([key, value]) => SAFE_METADATA_KEYS.has(key) && Number.isFinite(value)))
    const result = await processorRequest('/analyze', {
      session_token: sessionToken,
      view,
      verified_height_mm: heightMm,
      image_mime_type: prepared.mimeType,
      image_base64: prepared.imageBase64,
      candidate_index: candidateIndex,
      client_capture_metadata: { ...safeMetadata, width: prepared.width, height: prepared.height, encoded_bytes: prepared.byteSize },
    }, signal, processorUrl)
    onProgress('Checking photograph')
    return result
  } finally {
    if (prepared) prepared.imageBase64 = ''
    prepared = null
  }
}

export function finalizeServerObservations({ sessionToken, frontTokens, sideTokens, signal, processorUrl = PROCESSOR_URL }) {
  return processorRequest('/finalize', { session_token: sessionToken, front_observation_tokens: frontTokens, side_observation_tokens: sideTokens }, signal, processorUrl)
}
