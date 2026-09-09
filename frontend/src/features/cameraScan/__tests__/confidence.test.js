import { describe, expect, it } from 'vitest'
import { adjustQualityForWarnings, calculateConfidence, overallConfidence, repeatConsistencyConfidence } from '../geometry/confidence'
import { aggregateRepetitions, selectTemporallySeparatedFrames } from '../geometry/statistics'
import { assessRepeatability } from '../services/measurementPipeline'

describe('repetitions and confidence', () => {
  it('selects three high-quality separated frames', () => { const frames = Array.from({ length: 8 }, (_, i) => ({ id: i, timestamp: i * 100, qualityScore: i })); const selected = selectTemporallySeparatedFrames(frames, 3, 150); expect(selected).toHaveLength(3); expect(selected[1].timestamp - selected[0].timestamp).toBeGreaterThanOrEqual(150) })
  it('uses robust median and MAD', () => { expect(aggregateRepetitions([100, 101, 102, 900])).toMatchObject({ value: 101, mad: 1, sufficient: true }) })
  it('scores consistent repeats above dispersed repeats', () => { expect(repeatConsistencyConfidence(100, 1)).toBeGreaterThan(repeatConsistencyConfidence(100, 10)) })
  it('does not redistribute missing component weights', () => { expect(calculateConfidence({ captureQuality: 1, poseQuality: 1, segmentationQuality: 1, calibrationQuality: 1, repeatConsistency: 1 })).toBeCloseTo(.79) })
  it('uses the minimum valid measurement confidence overall', () => { expect(overallConfidence([{ observable: true, value_mm: 10, confidence: .8 }, { observable: true, value_mm: 20, confidence: .6 }])).toBe(.6) })
  it('forces overall quality to zero for a missing observable measurement', () => { expect(overallConfidence([{ observable: true, value_mm: 10, confidence: .8 }, { observable: true, value_mm: null, confidence: .9 }])).toBe(0) })
  it('marks a single uploaded pair as repeatability not assessed', () => { expect(assessRepeatability(1, 100, 0, .04)).toMatchObject({ score: 0, warnings: ['REPEATABILITY_NOT_ASSESSED'] }) })
  it('reduces quality for warnings and forces silhouette disagreement into retake quality', () => { expect(adjustQualityForWarnings(.9, ['IMAGE_BLURRED'])).toBeLessThan(.9); expect(adjustQualityForWarnings(.9, ['SILHOUETTE_DISAGREEMENT'])).toBeLessThan(.55) })
})
