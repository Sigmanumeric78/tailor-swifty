import { describe, expect, it, vi } from 'vitest'
import { analyzeImageQuality, evaluateQualityMetrics, luminanceMetrics } from '../services/opencvQualityService'

const image = (value) => ({ width: 2, height: 2, data: new Uint8ClampedArray(Array.from({ length: 4 }, () => [value, value, value, 255]).flat()) })

describe('OpenCV quality gates', () => {
  it('detects under/overexposure and low contrast', () => { expect(evaluateQualityMetrics({ sharpnessScore: 100, ...luminanceMetrics(image(5)), motionScore: 0 }).reasonCodes).toContain('TOO_DARK'); expect(evaluateQualityMetrics({ sharpnessScore: 100, ...luminanceMetrics(image(250)), motionScore: 0 }).reasonCodes).toContain('TOO_BRIGHT'); expect(evaluateQualityMetrics({ sharpnessScore: 100, ...luminanceMetrics(image(128)), motionScore: 0 }).reasonCodes).toContain('LOW_CONTRAST') })
  it('distinguishes synthetic sharp and blurred scores', () => { expect(evaluateQualityMetrics({ sharpnessScore: 120, meanLuminance: 120, darkFraction: 0, highlightFraction: 0, contrastScore: 40, motionScore: 0 }).passed).toBe(true); expect(evaluateQualityMetrics({ sharpnessScore: 10, meanLuminance: 120, darkFraction: 0, highlightFraction: 0, contrastScore: 40, motionScore: 0 }).reasonCodes).toContain('IMAGE_BLURRED') })
  it('deletes every allocated Mat when OpenCV throws', () => { const mats = []; const cv = { Mat: class { constructor() { this.delete = vi.fn(); mats.push(this) } }, matFromImageData: () => { const mat = new cv.Mat(); return mat }, cvtColor: vi.fn(), Laplacian: () => { throw new Error('fail') }, meanStdDev: vi.fn(), COLOR_RGBA2GRAY: 1, CV_64F: 2 }; expect(() => analyzeImageQuality(cv, image(100))).toThrow('fail'); expect(mats).toHaveLength(5); mats.forEach((mat) => expect(mat.delete).toHaveBeenCalledOnce()) })
})
