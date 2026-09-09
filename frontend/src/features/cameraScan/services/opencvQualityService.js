import { scanConfig } from '../scanConfig'
import { fillSmallHoles, maskBounds, selectTorsoConnectedComponent } from '../geometry/contours'

function pixelRegion(imageData, normalizedRoi) {
  if (!normalizedRoi) return { minX: 0, minY: 0, maxX: imageData.width - 1, maxY: imageData.height - 1 }
  const padding = scanConfig.quality.roiPaddingFraction
  return {
    minX: Math.max(0, Math.floor((normalizedRoi.minX - padding) * imageData.width)), minY: Math.max(0, Math.floor((normalizedRoi.minY - padding) * imageData.height)),
    maxX: Math.min(imageData.width - 1, Math.ceil((normalizedRoi.maxX + padding) * imageData.width)), maxY: Math.min(imageData.height - 1, Math.ceil((normalizedRoi.maxY + padding) * imageData.height)),
  }
}

export function luminanceMetrics(imageData, normalizedRoi = null) {
  const luminances = []
  const region = pixelRegion(imageData, normalizedRoi)
  for (let y = region.minY; y <= region.maxY; y += 1) for (let x = region.minX; x <= region.maxX; x += 1) {
    const index = (y * imageData.width + x) * 4
    luminances.push(0.2126 * imageData.data[index] + 0.7152 * imageData.data[index + 1] + 0.0722 * imageData.data[index + 2])
  }
  const meanLuminance = luminances.reduce((sum, value) => sum + value, 0) / luminances.length
  const variance = luminances.reduce((sum, value) => sum + (value - meanLuminance) ** 2, 0) / luminances.length
  return { meanLuminance, darkFraction: luminances.filter((value) => value < 25).length / luminances.length, highlightFraction: luminances.filter((value) => value > 245).length / luminances.length, contrastScore: Math.sqrt(variance) }
}

export function evaluateQualityMetrics(metrics) {
  const hardReasonCodes = []; const warningCodes = []
  if (metrics.sharpnessScore < scanConfig.quality.severeSharpnessMin) hardReasonCodes.push('IMAGE_BLURRED')
  if (metrics.meanLuminance < scanConfig.quality.severeLuminanceMin || metrics.darkFraction > scanConfig.quality.severeDarkFractionMax) hardReasonCodes.push('TOO_DARK')
  if (metrics.meanLuminance > scanConfig.quality.severeLuminanceMax || metrics.highlightFraction > scanConfig.quality.severeHighlightFractionMax) hardReasonCodes.push('TOO_BRIGHT')
  if (metrics.sharpnessScore < scanConfig.quality.sharpnessMin) warningCodes.push('IMAGE_BLURRED')
  if (metrics.meanLuminance < scanConfig.quality.luminanceMin || metrics.darkFraction > scanConfig.quality.darkFractionMax) warningCodes.push('TOO_DARK')
  if (metrics.meanLuminance > scanConfig.quality.luminanceMax || metrics.highlightFraction > scanConfig.quality.highlightFractionMax) warningCodes.push('TOO_BRIGHT')
  if (metrics.contrastScore < scanConfig.quality.contrastMin) warningCodes.push('LOW_CONTRAST')
  if (metrics.motionScore > scanConfig.pose.normalizedMotionMax) warningCodes.push('SUBJECT_MOVING')
  return { ...metrics, passed: hardReasonCodes.length === 0, hardReasonCodes: [...new Set(hardReasonCodes)], warningCodes: [...new Set(warningCodes.filter((code) => !hardReasonCodes.includes(code)))], reasonCodes: [...new Set([...hardReasonCodes, ...warningCodes])] }
}

export function analyzePreviewQuality(imageData, motionScore = 0, normalizedRoi = null) {
  const luminance = luminanceMetrics(imageData, normalizedRoi); let edgeTotal = 0; let samples = 0
  const region = pixelRegion(imageData, normalizedRoi)
  for (let y = Math.max(1, region.minY); y <= region.maxY; y += 2) for (let x = Math.max(1, region.minX); x <= region.maxX; x += 2) {
    const index = (y * imageData.width + x) * 4; const left = index - 4; const above = index - imageData.width * 4
    const gray = .2126 * imageData.data[index] + .7152 * imageData.data[index + 1] + .0722 * imageData.data[index + 2]
    const leftGray = .2126 * imageData.data[left] + .7152 * imageData.data[left + 1] + .0722 * imageData.data[left + 2]
    const aboveGray = .2126 * imageData.data[above] + .7152 * imageData.data[above + 1] + .0722 * imageData.data[above + 2]
    edgeTotal += Math.abs(gray - leftGray) + Math.abs(gray - aboveGray); samples += 2
  }
  const sharpnessScore = samples ? edgeTotal / samples : 0
  const metrics = evaluateQualityMetrics({ sharpnessScore: sharpnessScore * (scanConfig.quality.sharpnessMin / scanConfig.quality.previewSharpnessMin), ...luminance, motionScore })
  return { ...metrics, previewSharpnessScore: sharpnessScore }
}

export async function loadOpenCv() {
  const module = await import('@techstark/opencv-js')
  return module.default instanceof Promise ? module.default : module.default || module
}

export function cropImageDataToRoi(imageData, normalizedRoi) {
  if (!normalizedRoi) return imageData
  const region = pixelRegion(imageData, normalizedRoi); const width = region.maxX - region.minX + 1; const height = region.maxY - region.minY + 1
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const start = ((region.minY + y) * imageData.width + region.minX) * 4
    data.set(imageData.data.subarray(start, start + width * 4), y * width * 4)
  }
  return { width, height, data }
}

export function analyzeImageQuality(cv, imageData, motionScore = 0, normalizedRoi = null) {
  let source; let gray; let laplacian; let mean; let deviation
  try {
    const roiImageData = cropImageDataToRoi(imageData, normalizedRoi)
    source = cv.matFromImageData(roiImageData); gray = new cv.Mat(); laplacian = new cv.Mat(); mean = new cv.Mat(); deviation = new cv.Mat()
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY); cv.Laplacian(gray, laplacian, cv.CV_64F); cv.meanStdDev(laplacian, mean, deviation)
    const sharpnessScore = deviation.doubleAt(0, 0) ** 2 * (640 / Math.max(roiImageData.width, roiImageData.height)) ** 2
    return evaluateQualityMetrics({ sharpnessScore, ...luminanceMetrics(roiImageData), motionScore })
  } finally {
    for (const mat of [source, gray, laplacian, mean, deviation]) mat?.delete()
  }
}

export function scoreCapturedFrame(cv, frame, normalizedRoi = null) {
  const started = performance.now()
  const maximum = scanConfig.camera.previewMaxDimension
  const scale = Math.min(1, maximum / Math.max(frame.width, frame.height))
  const canvas = document.createElement('canvas'); canvas.width = Math.round(frame.width * scale); canvas.height = Math.round(frame.height * scale)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  try {
    context.drawImage(frame.bitmap, 0, 0, canvas.width, canvas.height)
    const metrics = analyzeImageQuality(cv, context.getImageData(0, 0, canvas.width, canvas.height), 0, normalizedRoi)
    const sharpness = Math.min(1, metrics.sharpnessScore / (scanConfig.quality.sharpnessMin * 2))
    const exposure = Math.max(0, 1 - Math.abs(metrics.meanLuminance - 130) / 130)
    const contrast = Math.min(1, metrics.contrastScore / (scanConfig.quality.contrastMin * 2))
    return { ...frame, qualityScore: 0.45 * sharpness + 0.3 * exposure + 0.25 * contrast, qualityMetrics: { ...metrics, inferenceTimeMs: performance.now() - started } }
  } finally { context.clearRect(0, 0, canvas.width, canvas.height); canvas.width = 0; canvas.height = 0 }
}

export function cleanupSilhouetteMask(cv, probabilities, width, height, threshold = scanConfig.mask.probabilityThreshold, landmarks = {}) {
  let source; let binary; let kernel; let closed
  try {
    const thresholded = Uint8Array.from(probabilities, (value) => value >= threshold ? 255 : 0)
    const rawBounds = maskBounds(Uint8Array.from(thresholded, (value) => value ? 1 : 0), width, height)
    const scaledKernel = Math.max(3, Math.min(15, Math.round((rawBounds?.height || height) * .01)))
    const kernelSize = scaledKernel % 2 ? scaledKernel : scaledKernel + 1
    source = cv.matFromArray(height, width, cv.CV_8UC1, thresholded)
    binary = new cv.Mat(); closed = new cv.Mat()
    cv.threshold(source, binary, 127, 255, cv.THRESH_BINARY)
    kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kernelSize, kernelSize)); cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel)
    const filled = fillSmallHoles(Uint8Array.from(closed.data, (value) => value ? 1 : 0), width, height)
    return selectTorsoConnectedComponent(filled, width, height, landmarks)
  } finally { for (const resource of [source, binary, kernel, closed]) resource?.delete() }
}
