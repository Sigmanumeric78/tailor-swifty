import { describe, expect, it } from 'vitest'
import { calibrateKnownHeight } from '../geometry/calibration'
import { largestConnectedComponent, torsoScanlineWidth } from '../geometry/contours'
import { ellipseCircumference, polylineLength, shirtLengthResult } from '../geometry/measurements'

const rectangle = (width, height, x1, y1, x2, y2) => { const mask = new Uint8Array(width * height); for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) mask[y * width + x] = 1; return mask }

describe('calibration and contour geometry', () => {
  it('calibrates 1800mm over 900px to 2mm/px independently', () => { const front = calibrateKnownHeight({ heightMm: 1800, mask: rectangle(400, 1000, 50, 50, 349, 949), width: 400, height: 1000 }); const side = calibrateKnownHeight({ heightMm: 1800, mask: rectangle(300, 1000, 50, 50, 249, 949), width: 300, height: 1000 }); expect(front.mmPerPixel).toBe(2); expect(side.mmPerPixel).toBe(2); expect(front).not.toBe(side) })
  it('rejects a truncated silhouette', () => { expect(calibrateKnownHeight({ heightMm: 1800, mask: rectangle(400, 1000, 50, 0, 349, 949), width: 400, height: 1000 }).warnings).toContain('TRUNCATED_SILHOUETTE') })
  it('propagates larger boundary uncertainty', () => { const mask = rectangle(400, 1000, 50, 50, 349, 949); const low = calibrateKnownHeight({ heightMm: 1800, mask, width: 400, height: 1000, boundaryUncertaintyPx: 1 }); const high = calibrateKnownHeight({ heightMm: 1800, mask, width: 400, height: 1000, boundaryUncertaintyPx: 10 }); expect(high.relativeScaleUncertainty).toBeGreaterThan(low.relativeScaleUncertainty) })
  it('keeps the largest connected component', () => { const mask = rectangle(10, 10, 1, 1, 5, 5); mask[99] = 1; expect([...largestConnectedComponent(mask, 10, 10)].reduce((a, b) => a + b, 0)).toBe(25) })
  it('selects the torso interval and resists one noisy row', () => { const mask = rectangle(20, 10, 7, 2, 12, 8); for (let x = 0; x < 20; x += 1) mask[5 * 20 + x] = 1; mask[4 * 20 + 1] = 1; mask[4 * 20 + 2] = 1; expect(torsoScanlineWidth(mask, 20, 10, 5, 10, 2).widthPx).toBe(6) })
  it('implements ellipse, sleeve polyline, and non-observable shirt length', () => { expect(ellipseCircumference(200, 200)).toBeCloseTo(Math.PI * 200); expect(polylineLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 8 }])).toBe(10); expect(shirtLengthResult()).toMatchObject({ value_mm: null, observable: false }) })
  it('returns null circumference when side depth is missing', () => { expect(ellipseCircumference(300, null)).toBeNull() })
})
