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

export function compareSilhouettes(first, second, width, height, torsoScanlines = []) {
  if (first.length !== second.length) throw new Error('Masks must share one coordinate system')
  const firstBounds = maskBounds(first, width, height); const secondBounds = maskBounds(second, width, height)
  const iou = maskIoU(first, second)
  const boundaryDisagreement = 1 - maskIoU(boundaryPixels(first, width, height), boundaryPixels(second, width, height))
  const heightDisagreement = firstBounds && secondBounds ? Math.abs(firstBounds.height - secondBounds.height) / Math.max(firstBounds.height, secondBounds.height) : 1
  const center = width / 2
  const widthDifferences = torsoScanlines.map((y) => {
    const a = torsoScanlineWidth(first, width, height, y, center).widthPx; const b = torsoScanlineWidth(second, width, height, y, center).widthPx
    return a && b ? Math.abs(a - b) / Math.max(a, b) : 1
  })
  const torsoWidthDisagreement = widthDifferences.length ? Math.max(...widthDifferences) : 0
  const passed = iou >= scanConfig.consensus.iouMin && boundaryDisagreement <= scanConfig.consensus.boundaryDisagreementMax && heightDisagreement <= scanConfig.consensus.heightDisagreementMax && torsoWidthDisagreement <= scanConfig.consensus.torsoWidthDisagreementMax
  return { iou, boundaryDisagreement, heightDisagreement, torsoWidthDisagreement, passed, reasonCodes: passed ? [] : ['SILHOUETTE_DISAGREEMENT'] }
}
