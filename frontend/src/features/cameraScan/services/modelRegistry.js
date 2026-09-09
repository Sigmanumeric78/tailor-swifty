import { BodyPixSegmentationService } from './bodyPixSegmentationService'
import { MediaPipePoseService } from './mediapipePoseService'
import { loadOpenCv } from './opencvQualityService'

export class CameraModelRegistry {
  constructor({ pose = new MediaPipePoseService(), bodyPixFactory = () => new BodyPixSegmentationService(), openCvLoader = loadOpenCv } = {}) {
    this.pose = pose; this.bodyPixFactory = bodyPixFactory; this.openCvLoader = openCvLoader; this.bodyPix = null; this.cv = null
    this.liveReady = false; this.qualityReady = false; this.segmentationReady = false; this.secondarySegmentationAvailable = false; this.segmentationWarnings = []; this.ready = false; this.disposed = false; this.generation = 0; this.livePromise = null; this.qualityPromise = null; this.segmentationPromise = null
    this.performanceMarks = { peakRetainedImages: 0 }; this.createdAt = performance.now()
  }
  async initializeLive() {
    if (this.disposed) throw new Error('Camera model registry was disposed')
    if (this.liveReady) return this
    if (this.livePromise) return this.livePromise
    const generation = this.generation
    this.livePromise = (async () => {
      const started = performance.now()
      try {
        await this.pose.initialize()
        if (this.disposed || generation !== this.generation) { this.pose.dispose(); throw new Error('Camera model initialization was cancelled') }
        this.performanceMarks.mediaPipeInitializationMs = performance.now() - started; this.liveReady = true; return this
      } catch (error) { this.pose.dispose(); this.liveReady = false; throw error }
      finally { this.livePromise = null }
    })()
    return this.livePromise
  }
  async initializeQuality() {
    if (this.disposed) throw new Error('Camera model registry was disposed')
    if (this.qualityReady) return this
    if (this.qualityPromise) return this.qualityPromise
    const generation = this.generation
    this.qualityPromise = (async () => {
      const started = performance.now()
      try {
        const cv = await this.openCvLoader()
        if (this.disposed || generation !== this.generation) throw new Error('OpenCV initialization was cancelled')
        this.cv = cv; this.performanceMarks.openCvInitializationMs = performance.now() - started; this.qualityReady = true; return this
      } catch (error) { this.cv = null; this.qualityReady = false; throw error }
      finally { this.qualityPromise = null }
    })()
    return this.qualityPromise
  }
  async initializeSegmentation() {
    await this.initializeLive()
    if (this.segmentationReady) return this
    if (this.segmentationPromise) return this.segmentationPromise
    const generation = this.generation
    this.bodyPix ||= this.bodyPixFactory()
    const bodyPix = this.bodyPix
    this.segmentationPromise = (async () => {
      const started = performance.now()
      try {
        await this.initializeQuality()
        if (this.disposed || generation !== this.generation) { bodyPix.dispose(); throw new Error('Segmentation initialization was cancelled') }
        try {
          await bodyPix.initialize()
          if (this.disposed || generation !== this.generation) { bodyPix.dispose(); throw new Error('Segmentation initialization was cancelled') }
          this.performanceMarks.bodyPixInitializationMs = performance.now() - started; this.secondarySegmentationAvailable = true; this.segmentationWarnings = []
        } catch (error) {
          if (/cancelled|disposed/.test(error.message)) throw error
          bodyPix.dispose(); if (this.bodyPix === bodyPix) this.bodyPix = null
          this.secondarySegmentationAvailable = false; this.segmentationWarnings = ['SECONDARY_SEGMENTER_UNAVAILABLE']
        }
        this.segmentationReady = true; this.ready = true; return this
      } catch (error) { bodyPix.dispose(); if (this.bodyPix === bodyPix) this.bodyPix = null; this.secondarySegmentationAvailable = false; this.segmentationReady = false; this.ready = false; throw error }
      finally { this.segmentationPromise = null }
    })()
    return this.segmentationPromise
  }
  async initialize() {
    try { await this.initializeLive(); await this.initializeSegmentation(); return this }
    catch (error) { this.dispose(); throw error }
  }
  getMetadata() { return [this.pose.getMetadata(), ...(this.bodyPix ? [this.bodyPix.getMetadata()] : [])] }
  recordInference(stage, durationMs) {
    if (!Number.isFinite(durationMs)) return
    const key = `${stage}InferenceMs`; const values = this.performanceMarks[key] || []
    this.performanceMarks[key] = [...values.slice(-19), durationMs]
    if (stage === 'mediaPipe' && this.performanceMarks.firstDetectionMs == null) this.performanceMarks.firstDetectionMs = performance.now() - this.createdAt
  }
  recordRetainedImages(count) { this.performanceMarks.peakRetainedImages = Math.max(this.performanceMarks.peakRetainedImages || 0, count) }
  getPerformanceMarks() { return Object.fromEntries(Object.entries(this.performanceMarks).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])) }
  dispose() { this.disposed = true; this.generation += 1; this.pose.dispose(); this.bodyPix?.dispose(); this.bodyPix = null; this.cv = null; this.liveReady = false; this.qualityReady = false; this.segmentationReady = false; this.secondarySegmentationAvailable = false; this.segmentationWarnings = []; this.ready = false; this.performanceMarks = {} }
}
