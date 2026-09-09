import { scanConfig } from '../scanConfig'
import { CalibrationMode, calibrationProviderFor } from '../geometry/calibrationProviders'
import { maskBounds, torsoScanlineWidth } from '../geometry/contours'
import { anatomicalSlicePositions } from '../geometry/landmarkSlices'
import { aggregateRepetitions } from '../geometry/statistics'
import { median } from '../geometry/statistics'
import { adjustQualityForWarnings, calculateConfidence, confidenceBand, overallConfidence, repeatConsistencyConfidence } from '../geometry/confidence'
import { armholeDepthResult, circumferenceResult, missingMeasurementResult, shoulderWidthResult, shirtLengthResult, sleeveLengthResult } from '../geometry/measurements'
import { fuseSegmentations } from './silhouetteConsensus'
import { cleanupSilhouetteMask, scoreCapturedFrame } from './opencvQualityService'
import { evaluatePoseGate } from './mediapipePoseService'
import { reasonInstructions } from '../reasonCodes'

export class FrameValidationError extends Error {
  constructor(frame, view, reasonCodes) {
    super(`${view} image: ${reasonInstructions[reasonCodes[0]] || reasonCodes[0]}`)
    this.name = 'FrameValidationError'; this.view = view; this.reasonCodes = reasonCodes
  }
}

export function assessRepeatability(repetitionCount, value, mad, toleranceFraction) {
  if (repetitionCount === 1) return { score: 0, warnings: ['REPEATABILITY_NOT_ASSESSED'], maximumQuality: scanConfig.confidence.highMin - 0.01 }
  return { score: repeatConsistencyConfidence(value, mad, toleranceFraction), warnings: [], maximumQuality: 1 }
}

function resizeMask(mask, sourceWidth, sourceHeight, width, height) {
  if (sourceWidth === width && sourceHeight === height) return mask
  const output = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) output[y * width + x] = mask[Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / height)) * sourceWidth + Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width))]
  return output
}

const pixelPoint = (point, width, height) => ({ x: point.x * width, y: point.y * height })
const usableLandmark = (point) => point && (point.visibility ?? 0) >= scanConfig.pose.landmarkVisibilityMin && (point.presence ?? 0) >= scanConfig.pose.landmarkPresenceMin
const normalizedBounds = (bounds, width, height) => bounds ? { minX: bounds.minX / width, maxX: bounds.maxX / width, minY: bounds.minY / height, maxY: bounds.maxY / height } : null
const touchesFrameBorder = (bounds, width, height) => bounds && (bounds.minX <= 0 || bounds.minY <= 0 || bounds.maxX >= width - 1 || bounds.maxY >= height - 1)

export async function validateCapturedFrame(registry, frame, view) {
  const mediaPipe = await registry.pose.segment(frame.bitmap)
  registry.recordInference?.('mediaPipe', mediaPipe.inferenceTimeMs)
  if (!mediaPipe.probabilityMask || !mediaPipe.landmarks) throw new FrameValidationError(frame, view, ['SEGMENTATION_MISSING'])
  const cleaned = cleanupSilhouetteMask(registry.cv, mediaPipe.probabilityMask, mediaPipe.width, mediaPipe.height, scanConfig.mask.probabilityThreshold, mediaPipe.landmarks)
  const bounds = maskBounds(cleaned, mediaPipe.width, mediaPipe.height)
  if (!bounds) throw new FrameValidationError(frame, view, ['SEGMENTATION_MISSING'])
  if (touchesFrameBorder(bounds, mediaPipe.width, mediaPipe.height)) throw new FrameValidationError(frame, view, ['SEVERE_BODY_TRUNCATION'])
  const poseGate = evaluatePoseGate({ poses: mediaPipe.poses, view, maskBounds: normalizedBounds(bounds, mediaPipe.width, mediaPipe.height), history: [] })
  if (poseGate.hardReasonCodes.length) throw new FrameValidationError(frame, view, poseGate.hardReasonCodes)
  const scoredFrame = scoreCapturedFrame(registry.cv, frame, normalizedBounds(bounds, mediaPipe.width, mediaPipe.height))
  registry.recordInference?.('openCv', scoredFrame.qualityMetrics?.inferenceTimeMs)
  if (scoredFrame.qualityMetrics.hardReasonCodes.length) throw new FrameValidationError(frame, view, scoredFrame.qualityMetrics.hardReasonCodes)
  const foregroundQuality = Math.max(0, Math.min(1, 1 - Math.abs(mediaPipe.foregroundFraction - .35) / .35))
  return { ...scoredFrame, qualityScore: .55 * scoredFrame.qualityScore + .3 * poseGate.poseQuality + .15 * foregroundQuality, poseQuality: poseGate.poseQuality, postCaptureWarnings: [...new Set([...(scoredFrame.qualityMetrics.warningCodes || []), ...poseGate.warningCodes])] }
}

async function analyzeFrame(registry, frame, heightMm, view, strictConsensus) {
  const mediaPipe = await registry.pose.segment(frame.bitmap)
  let bodyPix = null
  if (registry.bodyPix) {
    try { bodyPix = await registry.bodyPix.segment(frame.bitmap); registry.recordInference?.('bodyPix', bodyPix.inferenceTimeMs) } catch { bodyPix = null }
  }
  registry.recordInference?.('mediaPipe', mediaPipe.inferenceTimeMs)
  if (!mediaPipe.probabilityMask || !mediaPipe.landmarks) throw new FrameValidationError(frame, view, [...new Set([...mediaPipe.warnings, 'MODEL_UNAVAILABLE'])])
  const mediaMask = cleanupSilhouetteMask(registry.cv, mediaPipe.probabilityMask, mediaPipe.width, mediaPipe.height, scanConfig.mask.probabilityThreshold, mediaPipe.landmarks)
  const resizedBodyMask = bodyPix?.binaryMask ? resizeMask(bodyPix.binaryMask, bodyPix.width, bodyPix.height, mediaPipe.width, mediaPipe.height) : null
  const bodyMask = resizedBodyMask ? cleanupSilhouetteMask(registry.cv, resizedBodyMask, mediaPipe.width, mediaPipe.height, 0.5, mediaPipe.landmarks) : null
  const slices = anatomicalSlicePositions(mediaPipe.landmarks, mediaPipe.height)
  const fusion = fuseSegmentations(mediaMask, bodyMask, mediaPipe.width, mediaPipe.height, [slices.neck, slices.chest, ...slices.waistBand, ...slices.hipBand]); const consensus = fusion.consensus
  if (strictConsensus && bodyMask && !consensus.passed) throw new FrameValidationError(frame, view, consensus.reasonCodes)
  const cleaned = fusion.geometryMask
  const pixelBounds = maskBounds(cleaned, mediaPipe.width, mediaPipe.height)
  if (!pixelBounds) throw new FrameValidationError(frame, view, ['SEGMENTATION_MISSING'])
  if (touchesFrameBorder(pixelBounds, mediaPipe.width, mediaPipe.height)) throw new FrameValidationError(frame, view, ['SEVERE_BODY_TRUNCATION'])
  const scoredFrame = Number.isFinite(frame.qualityScore) && frame.qualityMetrics ? frame : scoreCapturedFrame(registry.cv, frame, normalizedBounds(pixelBounds, mediaPipe.width, mediaPipe.height))
  registry.recordInference?.('openCv', scoredFrame.qualityMetrics?.inferenceTimeMs)
  if (scoredFrame.qualityMetrics.hardReasonCodes.length) throw new FrameValidationError(frame, view, scoredFrame.qualityMetrics.hardReasonCodes)
  const poseGate = evaluatePoseGate({ poses: mediaPipe.poses, view, maskBounds: normalizedBounds(pixelBounds, mediaPipe.width, mediaPipe.height), history: [] })
  if (poseGate.hardReasonCodes.length) throw new FrameValidationError(frame, view, poseGate.hardReasonCodes)
  const landmarkList = Object.entries(mediaPipe.landmarks).map(([name, point]) => ({ ...point, name }))
  const calibration = calibrationProviderFor(CalibrationMode.VERIFIED_HEIGHT).calibrate({ heightMm, mask: cleaned, width: mediaPipe.width, height: mediaPipe.height, landmarks: landmarkList })
  if (!calibration.mmPerPixel) throw new FrameValidationError(frame, view, ['CALIBRATION_FAILED', ...calibration.warnings])
  const torsoCenter = ((mediaPipe.landmarks.left_hip.x + mediaPipe.landmarks.right_hip.x) / 2) * mediaPipe.width
  const widthAt = (y) => torsoScanlineWidth(cleaned, mediaPipe.width, mediaPipe.height, y, torsoCenter, 3)
  const scanBand = (band, chooser) => {
    const rows = []; const start = Math.round(band[0]); const end = Math.round(band[1])
    for (let y = start; y <= end; y += Math.max(1, Math.round((end - start) / 8))) { const measured = widthAt(y); if (measured.widthPx) rows.push(measured) }
    if (!rows.length) return { widthPx: null, y: null }
    return rows.sort((a, b) => chooser * (a.widthPx - b.widthPx))[0]
  }
  const raw = { neck: widthAt(slices.neck), chest: widthAt(slices.chest), waist: scanBand(slices.waistBand, 1), hip: scanBand(slices.hipBand, -1) }
  const widths = Object.fromEntries(Object.entries(raw).map(([code, item]) => [code, {
    widthMm: item.widthPx == null ? null : item.widthPx * calibration.mmPerPixel, y: item.y, frameId: frame.id,
    mmPerPixel: calibration.mmPerPixel, relativeUncertainty: calibration.relativeScaleUncertainty + (consensus.passed ? 0.02 : 0.1),
  }]))
  const warnings = [...new Set([...(scoredFrame.qualityMetrics.warningCodes || []), ...(frame.postCaptureWarnings || []), ...poseGate.warningCodes, ...(!consensus.passed ? consensus.reasonCodes : []), ...(registry.segmentationWarnings || [])])]
  return { frame: scoredFrame, width: mediaPipe.width, height: mediaPipe.height, landmarks: mediaPipe.landmarks, calibration, consensus, poseQuality: poseGate.poseQuality, warnings, widths }
}

export async function processCaptureRepetitions(registry, frontFrames, sideFrames, heightMm, { minimumValid = 3, source = 'camera_estimate', cameraMetadataAvailable = false, clothingFitConfirmed = false } = {}) {
  if (!Number.isInteger(minimumValid) || minimumValid < 1 || frontFrames.length !== sideFrames.length || frontFrames.length < minimumValid) throw new Error('Matching front and side repetitions are required')
  const fronts = []; const sides = []
  for (const frame of frontFrames) fronts.push(await analyzeFrame(registry, frame, heightMm, 'front', source === 'photo_estimate'))
  for (const frame of sideFrames) sides.push(await analyzeFrame(registry, frame, heightMm, 'side', source === 'photo_estimate'))
  const repeated = {}
  const circumferenceCodes = { neck: 'neck_circumference', chest: 'chest_circumference', waist: 'waist_circumference', hip: 'hip_circumference' }
  for (const [slice, code] of Object.entries(circumferenceCodes)) repeated[code] = fronts.map((front, index) => circumferenceResult(code, front.widths[slice], sides[index]?.widths[slice], 1))
  repeated.shoulder_width = fronts.map((front) => shoulderWidthResult(pixelPoint(front.landmarks.left_shoulder, front.width, front.height), pixelPoint(front.landmarks.right_shoulder, front.width, front.height), front.calibration, 1, front.frame.id))
  repeated.sleeve_length = fronts.map((front) => usableLandmark(front.landmarks.left_elbow) && usableLandmark(front.landmarks.left_wrist) ? sleeveLengthResult(pixelPoint(front.landmarks.left_shoulder, front.width, front.height), pixelPoint(front.landmarks.left_elbow, front.width, front.height), pixelPoint(front.landmarks.left_wrist, front.width, front.height), front.calibration, 1, front.frame.id) : missingMeasurementResult('sleeve_length'))
  repeated.armhole_depth = fronts.map((front) => armholeDepthResult(((front.landmarks.left_shoulder.y + front.landmarks.right_shoulder.y) / 2) * front.height, anatomicalSlicePositions(front.landmarks, front.height).chest, front.calibration, 1, front.frame.id))
  const measurements = {}
  const frontScale = median(fronts.map((item) => item.calibration.mmPerPixel)); const sideScale = median(sides.map((item) => item.calibration.mmPerPixel))
  const scaleDisagreement = Math.abs(frontScale - sideScale) / Math.max(frontScale, sideScale)
  for (const [code, results] of Object.entries(repeated)) {
    const aggregate = aggregateRepetitions(results.map((item) => item.value_mm), { ...scanConfig.repeats, minimumValid })
    const representative = results.find((item) => item.value_mm != null) || results[0]
    const segmentationQuality = Math.min(...fronts.map((item) => item.consensus.qualityScore), ...sides.map((item) => item.consensus.qualityScore))
    const calibrationQuality = Math.min(...fronts.map((item) => item.calibration.confidence), ...sides.map((item) => item.calibration.confidence))
    const captureQuality = Math.min(...fronts.map((item) => item.frame.qualityScore), ...sides.map((item) => item.frame.qualityScore))
    const poseQuality = Math.min(...fronts.map((item) => item.poseQuality), ...sides.map((item) => item.poseQuality))
    const repeatability = assessRepeatability(minimumValid, aggregate.value, aggregate.mad, scanConfig.repeats.toleranceFraction[code] || scanConfig.repeats.toleranceFraction.default)
    const repeatConsistency = repeatability.score
    const warnings = [...new Set([...representative.warnings, ...fronts.flatMap((item) => item.warnings), ...sides.flatMap((item) => item.warnings), ...(scaleDisagreement > scanConfig.calibration.maskLandmarkExtentTolerance ? ['SCALE_DISAGREEMENT'] : []), ...(!aggregate.sufficient ? ['REPEAT_DISAGREEMENT'] : []), ...repeatability.warnings])]
    const frontSideScaleAgreement = Math.max(0, 1 - scaleDisagreement / scanConfig.calibration.maskLandmarkExtentTolerance)
    let confidence = calculateConfidence({ captureQuality, poseQuality, segmentationQuality, calibrationQuality, repeatConsistency, observability: aggregate.sufficient && aggregate.value != null ? 1 : 0, frontSideScaleAgreement, cameraMetadata: cameraMetadataAvailable ? 1 : 0, clothingFit: clothingFitConfirmed ? 1 : 0 })
    confidence = adjustQualityForWarnings(Math.min(confidence, repeatability.maximumQuality), warnings)
    measurements[code] = { ...representative, source, value_mm: aggregate.sufficient ? Math.round(aggregate.value) : null, uncertainty_mm: aggregate.sufficient ? Math.max(representative.uncertainty_mm || 0, aggregate.mad || 0, 1) : null, confidence, confidence_level: confidenceBand(confidence), calibration_mode: CalibrationMode.VERIFIED_HEIGHT, model_versions: registry.getMetadata().map((item) => item.modelId), reason_codes: warnings, camera_metadata_available: cameraMetadataAvailable, warnings }
  }
  measurements.shirt_length = { ...shirtLengthResult(), source, confidence_level: 'low', calibration_mode: CalibrationMode.VERIFIED_HEIGHT, model_versions: registry.getMetadata().map((item) => item.modelId), reason_codes: ['MANUAL_HEM_POINT_REQUIRED'], camera_metadata_available: cameraMetadataAvailable }
  const score = overallConfidence(Object.values(measurements))
  const warnings = [...new Set(Object.values(measurements).flatMap((item) => item.warnings))]
  return { measurements, overallConfidence: score, warnings, frontCalibration: fronts[0].calibration, sideCalibration: sides[0].calibration }
}
