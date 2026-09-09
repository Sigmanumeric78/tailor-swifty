import { scanConfig } from '../scanConfig'
import { maskBounds, torsoScanlineWidth } from '../geometry/contours'

export function maskIoU(first, second) {
  let intersection = 0; let union = 0
  for (let index = 0; index < first.length; index += 1) { if (first[index] && second[index]) intersection += 1; if (first[index] || second[index]) union += 1 }
  return union ? intersection / union : 0
}

function boundaryPixels(mask, width, height) {
  const boundary = new Uint8Array(mask.length)
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const index = y * width + x
    if (mask[index] && (!mask[index - 1] || !mask[index + 1] || !mask[index - width] || !mask[index + width])) boundary[index] = 1
  }
  return boundary
}

function boundaryMatchFraction(source, target, width, height, tolerance) {
  let sourceCount = 0; let matched = 0
  for (let index = 0; index < source.length; index += 1) {
    if (!source[index]) continue
    sourceCount += 1; const x = index % width; const y = Math.floor(index / width); let found = false
    for (let offsetY = -tolerance; offsetY <= tolerance && !found; offsetY += 1) for (let offsetX = -tolerance; offsetX <= tolerance; offsetX += 1) {
      if (offsetX ** 2 + offsetY ** 2 > tolerance ** 2) continue
      const targetX = x + offsetX; const targetY = y + offsetY
      if (targetX >= 0 && targetX < width && targetY >= 0 && targetY < height && target[targetY * width + targetX]) { found = true; break }
    }
    if (found) matched += 1
  }
  return sourceCount ? matched / sourceCount : 0
}

export function geometryMaskFromConsensus(mediaPipeMask) { return new Uint8Array(mediaPipeMask) }

export const SEGMENTATION_FUSION_VERSION = 'primary-mediapipe-secondary-validation-1'

export function fuseSegmentations(primaryMask, secondaryMask, width, height, torsoScanlines = [], { strategy = 'primary' } = {}) {
  if (!primaryMask) throw new Error('Primary MediaPipe silhouette is required')
  if (strategy !== 'primary') throw new Error('UNVALIDATED_SEGMENTATION_FUSION_STRATEGY')
  if (!secondaryMask) return {
    version: SEGMENTATION_FUSION_VERSION, geometryMask: new Uint8Array(primaryMask),
    consensus: { iou: null, boundaryDisagreement: null, heightDisagreement: null, torsoWidthDisagreement: null, qualityScore: 0, passed: false, reasonCodes: ['SECONDARY_SEGMENTER_UNAVAILABLE'] },
  }
  return { version: SEGMENTATION_FUSION_VERSION, geometryMask: geometryMaskFromConsensus(primaryMask), consensus: compareSilhouettes(primaryMask, secondaryMask, width, height, torsoScanlines) }
}

export function compareSilhouettes(first, second, width, height, torsoScanlines = []) {
  if (first.length !== second.length) throw new Error('Masks must share one coordinate system')
  const firstBounds = maskBounds(first, width, height); const secondBounds = maskBounds(second, width, height)
  const iou = maskIoU(first, second)
  const firstBoundary = boundaryPixels(first, width, height); const secondBoundary = boundaryPixels(second, width, height)
  const silhouetteHeight = Math.max(firstBounds?.height || 0, secondBounds?.height || 0)
  const tolerance = Math.max(scanConfig.consensus.boundaryToleranceMinPx, Math.min(scanConfig.consensus.boundaryToleranceMaxPx, Math.round(silhouetteHeight * scanConfig.consensus.boundaryToleranceFraction)))
  const boundaryAgreement = (boundaryMatchFraction(firstBoundary, secondBoundary, width, height, tolerance) + boundaryMatchFraction(secondBoundary, firstBoundary, width, height, tolerance)) / 2
  const boundaryDisagreement = 1 - boundaryAgreement
  const heightDisagreement = firstBounds && secondBounds ? Math.abs(firstBounds.height - secondBounds.height) / Math.max(firstBounds.height, secondBounds.height) : 1
  const center = width / 2
  const widthDifferences = torsoScanlines.map((y) => {
    const a = torsoScanlineWidth(first, width, height, y, center).widthPx; const b = torsoScanlineWidth(second, width, height, y, center).widthPx
    return a && b ? Math.abs(a - b) / Math.max(a, b) : 1
  })
  const torsoWidthDisagreement = widthDifferences.length ? Math.max(...widthDifferences) : 0
  const passed = iou >= scanConfig.consensus.iouMin && boundaryDisagreement <= scanConfig.consensus.boundaryDisagreementMax && heightDisagreement <= scanConfig.consensus.heightDisagreementMax && torsoWidthDisagreement <= scanConfig.consensus.torsoWidthDisagreementMax
  const qualityScore = Math.max(0, Math.min(1, .5 * iou + .2 * (1 - boundaryDisagreement) + .15 * (1 - heightDisagreement) + .15 * (1 - torsoWidthDisagreement)))
  return { iou, boundaryDisagreement, boundaryTolerancePx: tolerance, heightDisagreement, torsoWidthDisagreement, qualityScore, passed, reasonCodes: passed ? [] : ['SILHOUETTE_DISAGREEMENT'] }
}
