import { PIPELINE_VERSION } from '../scanConfig'

export function ellipseCircumference(frontWidthMm, sideDepthMm) {
  if (!(frontWidthMm > 0) || !(sideDepthMm > 0)) return null
  const a = frontWidthMm / 2; const b = sideDepthMm / 2
  const h = ((a - b) ** 2) / ((a + b) ** 2)
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
}

export function polylineLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0)
}

const result = (measurement_code, value, confidence, uncertainty, evidence, warnings = [], observable = true) => ({
  measurement_code, value_mm: value == null ? null : Math.round(value), source: 'camera_estimate', confidence,
  uncertainty_mm: uncertainty == null ? null : Math.max(1, uncertainty), observable, requires_manual_confirmation: true,
  evidence: { ...evidence, algorithmVersion: PIPELINE_VERSION }, warnings,
})

export function circumferenceResult(code, front, side, confidence) {
  const value = ellipseCircumference(front?.widthMm, side?.widthMm)
  if (value == null) return result(code, null, 0, null, { frontWidthMm: front?.widthMm, sideDepthMm: side?.widthMm }, ['MISSING_VIEW_GEOMETRY'])
  const relative = Math.hypot(front.relativeUncertainty || 0, side.relativeUncertainty || 0)
  return result(code, value, confidence, value * relative, {
    frontFrameId: front.frameId, sideFrameId: side.frameId, frontWidthMm: front.widthMm, sideDepthMm: side.widthMm,
    frontScanlineY: front.y, sideScanlineY: side.y, mmPerPixel: { front: front.mmPerPixel, side: side.mmPerPixel },
  })
}

export function shoulderWidthResult(left, right, calibration, confidence, frameId) {
  const value = Math.hypot(right.x - left.x, right.y - left.y) * calibration.mmPerPixel
  return result('shoulder_width', value, confidence, value * calibration.relativeScaleUncertainty, { frontFrameId: frameId, landmarkIds: ['left_shoulder', 'right_shoulder'], mmPerPixel: calibration.mmPerPixel })
}

export function sleeveLengthResult(shoulder, elbow, wrist, calibration, confidence, frameId) {
  const value = polylineLength([shoulder, elbow, wrist]) * calibration.mmPerPixel
  return result('sleeve_length', value, confidence, value * calibration.relativeScaleUncertainty, { frontFrameId: frameId, landmarkIds: ['shoulder', 'elbow', 'wrist'], mmPerPixel: calibration.mmPerPixel })
}

export function armholeDepthResult(shoulderY, chestY, calibration, confidence, frameId) {
  const value = Math.abs(chestY - shoulderY) * calibration.mmPerPixel
  return result('armhole_depth', value, confidence * 0.75, value * (calibration.relativeScaleUncertainty + 0.08), { frontFrameId: frameId, landmarkIds: ['shoulders'], mmPerPixel: calibration.mmPerPixel }, ['ESTIMATED_ARMHOLE'])
}

export function shirtLengthResult() {
  return result('shirt_length', null, 0, null, {}, ['MANUAL_HEM_POINT_REQUIRED'], false)
}
