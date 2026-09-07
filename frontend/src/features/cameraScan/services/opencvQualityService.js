import { scanConfig } from '../scanConfig'

export function luminanceMetrics(imageData) {
  const luminances = []
  for (let index = 0; index < imageData.data.length; index += 4) luminances.push(0.2126 * imageData.data[index] + 0.7152 * imageData.data[index + 1] + 0.0722 * imageData.data[index + 2])
  const meanLuminance = luminances.reduce((sum, value) => sum + value, 0) / luminances.length
  const variance = luminances.reduce((sum, value) => sum + (value - meanLuminance) ** 2, 0) / luminances.length
  return { meanLuminance, darkFraction: luminances.filter((value) => value < 25).length / luminances.length, highlightFraction: luminances.filter((value) => value > 245).length / luminances.length, contrastScore: Math.sqrt(variance) }
}

export function evaluateQualityMetrics(metrics) {
  const reasonCodes = []
  if (metrics.sharpnessScore < scanConfig.quality.sharpnessMin) reasonCodes.push('IMAGE_BLURRED')
  if (metrics.meanLuminance < scanConfig.quality.luminanceMin || metrics.darkFraction > scanConfig.quality.darkFractionMax) reasonCodes.push('TOO_DARK')
  if (metrics.meanLuminance > scanConfig.quality.luminanceMax || metrics.highlightFraction > scanConfig.quality.highlightFractionMax) reasonCodes.push('TOO_BRIGHT')
  if (metrics.contrastScore < scanConfig.quality.contrastMin) reasonCodes.push('LOW_CONTRAST')
  if (metrics.motionScore > scanConfig.pose.normalizedMotionMax) reasonCodes.push('SUBJECT_MOVING')
  return { ...metrics, passed: reasonCodes.length === 0, reasonCodes }
}

export async function loadOpenCv() {
  const module = await import('@techstark/opencv-js')
  return module.default instanceof Promise ? module.default : module.default || module
}

export function analyzeImageQuality(cv, imageData, motionScore = 0) {
  let source; let gray; let laplacian; let mean; let deviation
  try {
    source = cv.matFromImageData(imageData); gray = new cv.Mat(); laplacian = new cv.Mat(); mean = new cv.Mat(); deviation = new cv.Mat()
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY); cv.Laplacian(gray, laplacian, cv.CV_64F); cv.meanStdDev(laplacian, mean, deviation)
    const sharpnessScore = deviation.doubleAt(0, 0) ** 2 * (640 / Math.max(imageData.width, imageData.height)) ** 2
    return evaluateQualityMetrics({ sharpnessScore, ...luminanceMetrics(imageData), motionScore })
  } finally {
    for (const mat of [source, gray, laplacian, mean, deviation]) mat?.delete()
  }
}

export function scoreCapturedFrame(cv, frame) {
  const maximum = scanConfig.camera.previewMaxDimension
  const scale = Math.min(1, maximum / Math.max(frame.width, frame.height))
  const canvas = document.createElement('canvas'); canvas.width = Math.round(frame.width * scale); canvas.height = Math.round(frame.height * scale)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  try {
    context.drawImage(frame.bitmap, 0, 0, canvas.width, canvas.height)
    const metrics = analyzeImageQuality(cv, context.getImageData(0, 0, canvas.width, canvas.height))
    const sharpness = Math.min(1, metrics.sharpnessScore / (scanConfig.quality.sharpnessMin * 2))
    const exposure = Math.max(0, 1 - Math.abs(metrics.meanLuminance - 130) / 130)
    const contrast = Math.min(1, metrics.contrastScore / (scanConfig.quality.contrastMin * 2))
    return { ...frame, qualityScore: 0.45 * sharpness + 0.3 * exposure + 0.25 * contrast, qualityMetrics: metrics }
  } finally { context.clearRect(0, 0, canvas.width, canvas.height); canvas.width = 0; canvas.height = 0 }
}

export function cleanupSilhouetteMask(cv, probabilities, width, height, threshold = scanConfig.mask.probabilityThreshold) {
  let source; let binary; let kernel; let closed; let contours; let hierarchy; let cleaned
  try {
    source = cv.matFromArray(height, width, cv.CV_8UC1, Uint8Array.from(probabilities, (value) => value >= threshold ? 255 : 0))
    binary = new cv.Mat(); closed = new cv.Mat(); contours = new cv.MatVector(); hierarchy = new cv.Mat()
    cv.threshold(source, binary, 127, 255, cv.THRESH_BINARY)
    kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5)); cv.morphologyEx(binary, closed, cv.MORPH_CLOSE, kernel)
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    cleaned = cv.Mat.zeros(height, width, cv.CV_8UC1)
    let largest = -1; let largestArea = 0
    for (let index = 0; index < contours.size(); index += 1) { const contour = contours.get(index); try { const area = cv.contourArea(contour); if (area > largestArea) { largestArea = area; largest = index } } finally { contour.delete() } }
    if (largest >= 0) cv.drawContours(cleaned, contours, largest, new cv.Scalar(255), cv.FILLED)
    return Uint8Array.from(cleaned.data, (value) => value ? 1 : 0)
  } finally { for (const resource of [source, binary, kernel, closed, contours, hierarchy, cleaned]) resource?.delete() }
}
