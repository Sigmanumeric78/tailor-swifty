import { BodyPixSegmentationService } from './bodyPixSegmentationService'
import { MediaPipePoseService } from './mediapipePoseService'
import { loadOpenCv } from './opencvQualityService'

export class CameraModelRegistry {
  constructor({ pose = new MediaPipePoseService(), bodyPixFactory = () => new BodyPixSegmentationService(), openCvLoader = loadOpenCv } = {}) {
    this.pose = pose; this.bodyPixFactory = bodyPixFactory; this.openCvLoader = openCvLoader; this.bodyPix = null; this.cv = null
    this.liveReady = false; this.segmentationReady = false; this.ready = false; this.disposed = false; this.generation = 0; this.livePromise = null; this.segmentationPromise = null
  }
  async initializeLive() {
    if (this.disposed) throw new Error('Camera model registry was disposed')
    if (this.liveReady) return this
    if (this.livePromise) return this.livePromise
    const generation = this.generation
    this.livePromise = (async () => {
      try {
        const [, cv] = await Promise.all([this.pose.initialize(), this.openCvLoader()])
        if (this.disposed || generation !== this.generation) { this.pose.dispose(); throw new Error('Camera model initialization was cancelled') }
        this.cv = cv; this.liveReady = true; return this
      } catch (error) { this.pose.dispose(); this.cv = null; this.liveReady = false; throw error }
      finally { this.livePromise = null }
    })()
    return this.livePromise
  }
  async initializeSegmentation() {
    await this.initializeLive()
    if (this.segmentationReady) return this
    if (this.segmentationPromise) return this.segmentationPromise
    const generation = this.generation
    this.bodyPix ||= this.bodyPixFactory()
    this.segmentationPromise = (async () => {
      try {
        await this.bodyPix.initialize()
        if (this.disposed || generation !== this.generation) { this.bodyPix.dispose(); throw new Error('Segmentation initialization was cancelled') }
        this.segmentationReady = true; this.ready = true; return this
      } catch (error) { this.bodyPix?.dispose(); this.bodyPix = null; this.segmentationReady = false; this.ready = false; throw error }
      finally { this.segmentationPromise = null }
    })()
    return this.segmentationPromise
  }
  async initialize() {
    try { await this.initializeLive(); await this.initializeSegmentation(); return this }
    catch (error) { this.dispose(); throw error }
  }
  getMetadata() { return [this.pose.getMetadata(), ...(this.bodyPix ? [this.bodyPix.getMetadata()] : [])] }
  dispose() { this.disposed = true; this.generation += 1; this.pose.dispose(); this.bodyPix?.dispose(); this.bodyPix = null; this.cv = null; this.liveReady = false; this.segmentationReady = false; this.ready = false }
}
