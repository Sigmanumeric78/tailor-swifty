import { BodyPixSegmentationService } from './bodyPixSegmentationService'
import { MediaPipePoseService } from './mediapipePoseService'
import { loadOpenCv } from './opencvQualityService'

export class CameraModelRegistry {
  constructor() { this.pose = new MediaPipePoseService(); this.bodyPix = new BodyPixSegmentationService(); this.cv = null; this.ready = false }
  async initialize() { const [, , cv] = await Promise.all([this.pose.initialize(), this.bodyPix.initialize(), loadOpenCv()]); this.cv = cv; this.ready = true; return this }
  getMetadata() { return [this.pose.getMetadata(), this.bodyPix.getMetadata()] }
  dispose() { this.pose.dispose(); this.bodyPix.dispose(); this.cv = null; this.ready = false }
}
