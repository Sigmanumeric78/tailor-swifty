import { scanConfig } from '../scanConfig'

export const bodyPixConfiguration = Object.freeze({ architecture: 'ResNet50', outputStride: 16, multiplier: 1, quantBytes: 2, modelUrl: '/models/bodypix/resnet50/quant2/model-stride16.json' })

export class BodyPixSegmentationService {
  constructor() { this.segmenter = null; this.tf = null }
  async initialize() {
    const [tf, bodySegmentation] = await Promise.all([import('@tensorflow/tfjs-core'), import('@tensorflow-models/body-segmentation')])
    await import('@tensorflow/tfjs-backend-webgl')
    try { await tf.setBackend('webgl') } catch {
      const wasm = await import('@tensorflow/tfjs-backend-wasm')
      wasm.setWasmPaths('/models/tensorflow/wasm/')
      await tf.setBackend('wasm')
    }
    await tf.ready(); this.tf = tf
    this.segmenter = await bodySegmentation.createSegmenter(bodySegmentation.SupportedModels.BodyPix, bodyPixConfiguration)
  }
  async segment(imageSource, options = {}) {
    const started = performance.now()
    const people = await this.segmenter.segmentPeople(imageSource, { multiSegmentation: false, segmentBodyParts: true, flipHorizontal: Boolean(options.flipHorizontal) })
    if (!people.length) return { modelId: 'bodypix-resnet50-stride16-quant2', width: imageSource.width, height: imageSource.height, binaryMask: null, inferenceTimeMs: performance.now() - started, foregroundFraction: 0, warnings: ['NO_PERSON'] }
    const tensor = await people[0].mask.toTensor()
    try {
      const values = await tensor.data(); const [height, width] = tensor.shape
      const binaryMask = Uint8Array.from(values, (value) => value >= scanConfig.mask.probabilityThreshold ? 1 : 0)
      const foregroundFraction = binaryMask.reduce((sum, value) => sum + value, 0) / binaryMask.length
      return { modelId: 'bodypix-resnet50-stride16-quant2', width, height, binaryMask, inferenceTimeMs: performance.now() - started, foregroundFraction, warnings: [] }
    } finally { tensor.dispose() }
  }
  getMetadata() { return { modelId: 'bodypix-resnet50-stride16-quant2', ...bodyPixConfiguration, mode: 'single-person/high-accuracy' } }
  dispose() { this.segmenter?.dispose(); this.segmenter = null; this.tf = null }
}
