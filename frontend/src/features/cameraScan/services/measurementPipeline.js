import { scanConfig } from '../scanConfig'
import { calibrateKnownHeight } from '../geometry/calibration'
import { torsoScanlineWidth } from '../geometry/contours'
import { anatomicalSlicePositions } from '../geometry/landmarkSlices'
import { aggregateRepetitions } from '../geometry/statistics'
import { calculateConfidence, overallConfidence, repeatConsistencyConfidence } from '../geometry/confidence'
import { armholeDepthResult, circumferenceResult, shoulderWidthResult, shirtLengthResult, sleeveLengthResult } from '../geometry/measurements'
import { compareSilhouettes } from './silhouetteConsensus'
import { cleanupSilhouetteMask } from './opencvQualityService'

function resizeMask(mask, sourceWidth, sourceHeight, width, height) {
  if (sourceWidth === width && sourceHeight === height) return mask
  const output = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) output[y * width + x] = mask[Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / height)) * sourceWidth + Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / width))]
  return output
}

const pixelPoint = (point, width, height) => ({ x: point.x * width, y: point.y * height })

async function analyzeFrame(registry, frame, heightMm) {
  const [mediaPipe, bodyPix] = await Promise.all([registry.pose.segment(frame.bitmap), registry.bodyPix.segment(frame.bitmap)])
  if (!mediaPipe.probabilityMask || !bodyPix.binaryMask || !mediaPipe.landmarks) throw new Error('A selected frame could not be segmented')
  const mediaMask = cleanupSilhouetteMask(registry.cv, mediaPipe.probabilityMask, mediaPipe.width, mediaPipe.height)
  const resizedBodyMask = resizeMask(bodyPix.binaryMask, bodyPix.width, bodyPix.height, mediaPipe.width, mediaPipe.height)
  const bodyMask = cleanupSilhouetteMask(registry.cv, resizedBodyMask, mediaPipe.width, mediaPipe.height, 0.5)
  const slices = anatomicalSlicePositions(mediaPipe.landmarks, mediaPipe.height)
  const consensus = compareSilhouettes(mediaMask, bodyMask, mediaPipe.width, mediaPipe.height, [slices.neck, slices.chest, ...slices.waistBand, ...slices.hipBand])
  const cleaned = consensus.passed ? mediaMask.map((value, index) => value && bodyMask[index] ? 1 : 0) : mediaMask
  const landmarkList = Object.entries(mediaPipe.landmarks).map(([name, point]) => ({ ...point, name }))
  const calibration = calibrateKnownHeight({ heightMm, mask: cleaned, width: mediaPipe.width, height: mediaPipe.height, landmarks: landmarkList })
  if (!calibration.mmPerPixel) throw new Error(`Calibration failed: ${calibration.warnings.join(', ')}`)
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
  return { frame, width: mediaPipe.width, height: mediaPipe.height, landmarks: mediaPipe.landmarks, calibration, consensus, widths }
}

export async function processCaptureRepetitions(registry, frontFrames, sideFrames, heightMm) {
  const fronts = []; const sides = []
  for (const frame of frontFrames) fronts.push(await analyzeFrame(registry, frame, heightMm))
  for (const frame of sideFrames) sides.push(await analyzeFrame(registry, frame, heightMm))
  const repeated = {}
  const circumferenceCodes = { neck: 'neck_circumference', chest: 'chest_circumference', waist: 'waist_circumference', hip: 'hip_circumference' }
  for (const [slice, code] of Object.entries(circumferenceCodes)) repeated[code] = fronts.map((front, index) => circumferenceResult(code, front.widths[slice], sides[index]?.widths[slice], 1))
  repeated.shoulder_width = fronts.map((front) => shoulderWidthResult(pixelPoint(front.landmarks.left_shoulder, front.width, front.height), pixelPoint(front.landmarks.right_shoulder, front.width, front.height), front.calibration, 1, front.frame.id))
  repeated.sleeve_length = fronts.map((front) => sleeveLengthResult(pixelPoint(front.landmarks.left_shoulder, front.width, front.height), pixelPoint(front.landmarks.left_elbow, front.width, front.height), pixelPoint(front.landmarks.left_wrist, front.width, front.height), front.calibration, 1, front.frame.id))
  repeated.armhole_depth = fronts.map((front) => armholeDepthResult(((front.landmarks.left_shoulder.y + front.landmarks.right_shoulder.y) / 2) * front.height, anatomicalSlicePositions(front.landmarks, front.height).chest, front.calibration, 1, front.frame.id))
  const measurements = {}
  for (const [code, results] of Object.entries(repeated)) {
    const aggregate = aggregateRepetitions(results.map((item) => item.value_mm), scanConfig.repeats)
    const representative = results.find((item) => item.value_mm != null) || results[0]
    const segmentationQuality = Math.min(...fronts.map((item) => item.consensus.iou), ...sides.map((item) => item.consensus.iou))
    const calibrationQuality = Math.min(...fronts.map((item) => item.calibration.confidence), ...sides.map((item) => item.calibration.confidence))
    const confidence = calculateConfidence({ captureQuality: 0.9, poseQuality: 0.9, segmentationQuality, calibrationQuality, repeatConsistency: repeatConsistencyConfidence(aggregate.value, aggregate.mad), observability: aggregate.sufficient ? 1 : 0 })
    measurements[code] = { ...representative, value_mm: aggregate.sufficient ? Math.round(aggregate.value) : null, uncertainty_mm: aggregate.sufficient ? Math.max(representative.uncertainty_mm || 0, aggregate.mad || 0, 1) : null, confidence, warnings: [...representative.warnings, ...(!aggregate.sufficient ? ['REPEAT_DISAGREEMENT'] : [])] }
  }
  measurements.shirt_length = shirtLengthResult()
  const score = overallConfidence(Object.values(measurements))
  const warnings = [...new Set(Object.values(measurements).flatMap((item) => item.warnings))]
  return { measurements, overallConfidence: score, warnings, frontCalibration: fronts[0].calibration, sideCalibration: sides[0].calibration }
}
