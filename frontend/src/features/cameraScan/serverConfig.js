export const CAMERA_PROCESSING_MODE = import.meta.env.VITE_CAMERA_PROCESSING_MODE
  || (import.meta.env.MODE === 'test' ? 'browser-research' : 'server')

export const SERVER_PIPELINE_VERSION = 'server-camera-0.1.0'
export const SERVER_CONSENT_VERSION = 'server-camera-consent-1'

export const serverImageConfig = Object.freeze({
  preferredLongEdge: 1280,
  maximumLongEdge: 1600,
  maximumCompressedBytes: 2_500_000,
  maximumRequestBytes: 4_500_000,
  minimumQuality: 0.55,
  initialQuality: 0.9,
  qualityStep: 0.08,
  requestTimeoutMs: 60_000,
  maximumCandidatesPerView: 3,
})
