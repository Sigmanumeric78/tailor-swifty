import { describe, expect, it, vi } from 'vitest'
import { analyzeImageQuality, evaluateQualityMetrics, luminanceMetrics } from '../services/opencvQualityService'

const image = (value) => ({ width: 2, height: 2, data: new Uint8ClampedArray(Array.from({ length: 4 }, () => [value, value, value, 255]).flat()) })

describe('OpenCV quality gates', () => {
  it('detects under/overexposure and low contrast', () => { expect(evaluateQualityMetrics({ sharpnessScore: 100, ...luminanceMetrics(image(5)), motionScore: 0 }).reasonCodes).toContain('TOO_DARK'); expect(evaluateQualityMetrics({ sharpnessScore: 100, ...luminanceMetrics(image(250)), motionScore: 0 }).reasonCodes).toContain('TOO_BRIGHT'); expect(evaluateQualityMetrics({ sharpnessScore: 100, ...luminanceMetrics(image(128)), motionScore: 0 }).reasonCodes).toContain('LOW_CONTRAST') })
  it('keeps moderate blur advisory rather than making the manual shutter unavailable', () => { expect(evaluateQualityMetrics({ sharpnessScore: 120, meanLuminance: 120, darkFraction: 0, highlightFraction: 0, contrastScore: 40, motionScore: 0 }).passed).toBe(true); const blurred = evaluateQualityMetrics({ sharpnessScore: 10, meanLuminance: 120, darkFraction: 0, highlightFraction: 0, contrastScore: 40, motionScore: 0 }); expect(blurred.passed).toBe(true); expect(blurred.hardReasonCodes).toEqual([]); expect(blurred.warningCodes).toContain('IMAGE_BLURRED') })
  it('measures luminance inside the expanded person ROI rather than the unrelated background', () => {
    const data = new Uint8ClampedArray(10 * 2 * 4)
    for (let pixel = 0; pixel < 20; pixel += 1) { const value = pixel % 10 >= 4 && pixel % 10 <= 5 ? 120 : 250; data.set([value, value, value, 255], pixel * 4) }
    const metrics = luminanceMetrics({ width: 10, height: 2, data }, { minX: .4, maxX: .5, minY: 0, maxY: 1 })
    expect(metrics.meanLuminance).toBeLessThan(200)
  })
  it('deletes every allocated Mat when OpenCV throws', () => { const mats = []; const cv = { Mat: class { constructor() { this.delete = vi.fn(); mats.push(this) } }, matFromImageData: () => { const mat = new cv.Mat(); return mat }, cvtColor: vi.fn(), Laplacian: () => { throw new Error('fail') }, meanStdDev: vi.fn(), COLOR_RGBA2GRAY: 1, CV_64F: 2 }; expect(() => analyzeImageQuality(cv, image(100))).toThrow('fail'); expect(mats).toHaveLength(5); mats.forEach((mat) => expect(mat.delete).toHaveBeenCalledOnce()) })
})
