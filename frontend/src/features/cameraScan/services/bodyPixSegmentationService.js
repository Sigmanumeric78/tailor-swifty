import { scanConfig } from '../scanConfig'

export const bodyPixConfiguration = Object.freeze({ architecture: 'ResNet50', outputStride: 16, multiplier: 1, quantBytes: 2, modelUrl: '/models/bodypix/resnet50/quant2/model-stride16.json' })

export function binaryMaskFromRgba(rgba, threshold = scanConfig.mask.probabilityThreshold) {
  if (!rgba || !Number.isInteger(rgba.width) || !Number.isInteger(rgba.height) || rgba.width <= 0 || rgba.height <= 0 || rgba.data?.length !== rgba.width * rgba.height * 4) throw new Error('BodyPix returned an invalid RGBA mask')
  const binaryMask = new Uint8Array(rgba.width * rgba.height)
  for (let index = 0; index < binaryMask.length; index += 1) binaryMask[index] = rgba.data[index * 4 + 3] / 255 >= threshold ? 1 : 0
  return binaryMask
}

export async function selectTensorFlowBackend(tf, {
  loadWebgl = () => import('@tensorflow/tfjs-backend-webgl'),
  loadWasm = () => import('@tensorflow/tfjs-backend-wasm'),
} = {}) {
  const attempt = async (name) => {
    if (!await tf.setBackend(name)) return false
    await tf.ready()
    return tf.getBackend() === name
  }
  try {
    await loadWebgl()
    if (await attempt('webgl')) return 'webgl'
  } catch { /* Continue to the registered WASM fallback. */ }
  try {
    const wasmModule = await loadWasm(); const wasm = wasmModule.default || wasmModule
    wasm.setWasmPaths('/models/tensorflow/wasm/')
    if (await attempt('wasm')) return 'wasm'
  } catch { /* Report only the stable non-sensitive reason code below. */ }
  throw new Error('MODEL_BACKEND_UNAVAILABLE: webgl, wasm')
}

export class BodyPixSegmentationService {
  constructor({ backendSelector = selectTensorFlowBackend } = {}) { this.segmenter = null; this.tf = null; this.selectedBackend = null; this.backendSelector = backendSelector }
  async initialize() {
    const [tf, bodySegmentation] = await Promise.all([import('@tensorflow/tfjs-core'), import('@tensorflow-models/body-segmentation')])
    this.selectedBackend = await this.backendSelector(tf); this.tf = tf
    this.segmenter = await bodySegmentation.createSegmenter(bodySegmentation.SupportedModels.BodyPix, bodyPixConfiguration)
  }
  async segment(imageSource, options = {}) {
    const started = performance.now()
    // The WASM BatchMatMul kernel cannot decode BodyPix's int32 body-part map.
    // Person-only segmentation uses the same locked ResNet50 silhouette model
    // without that unsupported post-processing operation.
    const segmentBodyParts = this.selectedBackend === 'webgl'
    const people = await this.segmenter.segmentPeople(imageSource, { multiSegmentation: false, segmentBodyParts, flipHorizontal: Boolean(options.flipHorizontal) })
    if (!people.length) return { modelId: 'bodypix-resnet50-stride16-quant2', width: imageSource.width, height: imageSource.height, binaryMask: null, inferenceTimeMs: performance.now() - started, foregroundFraction: 0, warnings: ['NO_PERSON'] }
    try {
      const rgba = await people[0].mask.toImageData()
      const binaryMask = binaryMaskFromRgba(rgba)
      const foregroundFraction = binaryMask.reduce((sum, value) => sum + value, 0) / binaryMask.length
      return { modelId: 'bodypix-resnet50-stride16-quant2', width: rgba.width, height: rgba.height, binaryMask, inferenceTimeMs: performance.now() - started, foregroundFraction, warnings: [] }
    } finally { people.forEach((person) => person.mask?.dispose?.()) }
  }
  getMetadata() { return { modelId: 'bodypix-resnet50-stride16-quant2', ...bodyPixConfiguration, mode: 'single-person/high-accuracy', selectedBackend: this.selectedBackend, segmentBodyParts: this.selectedBackend === 'webgl' } }
  dispose() { this.segmenter?.dispose(); this.segmenter = null; this.tf = null; this.selectedBackend = null }
}
