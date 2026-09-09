import { scanConfig } from '../scanConfig'
import { maskBounds } from './contours'

export function calibrateKnownHeight({ heightMm, mask, width, height, landmarks = [], boundaryUncertaintyPx = scanConfig.calibration.boundaryUncertaintyPx, heightInputUncertaintyMm = scanConfig.heightMm.inputUncertaintyMm }) {
  if (!Number.isInteger(heightMm) || heightMm < scanConfig.heightMm.min || heightMm > scanConfig.heightMm.max) return failure('INVALID_HEIGHT')
  const bounds = maskBounds(mask, width, height)
  if (!bounds || bounds.minY <= 0 || bounds.maxY >= height - 1) return failure('TRUNCATED_SILHOUETTE')
  const aspectRatio = bounds.height / bounds.width
  if (aspectRatio < scanConfig.calibration.aspectRatioMin || aspectRatio > scanConfig.calibration.aspectRatioMax) return failure('IMPLAUSIBLE_ASPECT_RATIO')
  const visibleFeet = landmarks.filter((point) => ['left_heel', 'right_heel', 'left_foot_index', 'right_foot_index'].includes(point.name) && point.visibility >= scanConfig.pose.landmarkVisibilityMin)
  if (landmarks.length && !visibleFeet.length) return failure('FEET_NOT_CONNECTED')
  const landmarkYs = landmarks.filter((point) => Number.isFinite(point.y) && (point.visibility ?? 1) >= scanConfig.pose.landmarkVisibilityMin && (point.presence ?? 1) >= scanConfig.pose.landmarkPresenceMin).map((point) => point.y * height)
  if (landmarkYs.length) {
    const extent = Math.max(...landmarkYs) - Math.min(...landmarkYs)
    if (Math.abs(extent - bounds.height) / bounds.height > scanConfig.calibration.maskLandmarkExtentTolerance) return failure('MASK_LANDMARK_EXTENT_DISAGREEMENT')
  }
  const mmPerPixel = heightMm / bounds.height
  const relativeScaleUncertainty = Math.sqrt((heightInputUncertaintyMm / heightMm) ** 2 + (boundaryUncertaintyPx / bounds.height) ** 2)
  return { heightMm, silhouetteHeightPx: bounds.height, mmPerPixel, boundaryUncertaintyPx, relativeScaleUncertainty, confidence: Math.max(0, 1 - relativeScaleUncertainty * 10), warnings: [], bounds }
}

function failure(warning) {
  return { heightMm: null, silhouetteHeightPx: null, mmPerPixel: null, boundaryUncertaintyPx: null, relativeScaleUncertainty: null, confidence: 0, warnings: [warning] }
}
