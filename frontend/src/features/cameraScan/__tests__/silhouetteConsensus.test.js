import { expect, it } from 'vitest'
import { compareSilhouettes, fuseSegmentations, geometryMaskFromConsensus, maskIoU } from '../services/silhouetteConsensus'

it('reports exact agreement and flags silhouette disagreement', () => {
  const first = new Uint8Array(100); const second = new Uint8Array(100)
  for (let y = 2; y < 8; y += 1) for (let x = 3; x < 7; x += 1) first[y * 10 + x] = second[y * 10 + x] = 1
  expect(maskIoU(first, second)).toBe(1)
  second.fill(0); for (let y = 2; y < 8; y += 1) for (let x = 6; x < 9; x += 1) second[y * 10 + x] = 1
  expect(compareSilhouettes(first, second, 10, 10, [4, 6])).toMatchObject({ passed: false, reasonCodes: ['SILHOUETTE_DISAGREEMENT'] })
})

it('tolerates a three-pixel boundary translation on a large silhouette', () => {
  const width = 80; const height = 120; const first = new Uint8Array(width * height); const shifted = new Uint8Array(width * height)
  for (let y = 10; y < 110; y += 1) for (let x = 20; x < 60; x += 1) first[y * width + x] = 1
  for (let y = 10; y < 110; y += 1) for (let x = 23; x < 63; x += 1) shifted[y * width + x] = 1
  const result = compareSilhouettes(first, shifted, width, height, [40, 60, 80])
  expect(result.boundaryDisagreement).toBeLessThan(.2); expect(result.passed).toBe(true)
})

it('always uses the MediaPipe mask for geometry instead of an intersection', () => {
  const mediaPipe = new Uint8Array([1, 1, 1, 1]); const bodyPix = new Uint8Array([0, 1, 1, 0])
  expect([...geometryMaskFromConsensus(mediaPipe, bodyPix)]).toEqual([1, 1, 1, 1])
})

it('keeps primary geometry when the secondary model is unavailable', () => {
  const primary = new Uint8Array([1, 1, 1, 1]); const fusion = fuseSegmentations(primary, null, 2, 2)
  expect([...fusion.geometryMask]).toEqual([...primary]); expect(fusion.consensus.reasonCodes).toEqual(['SECONDARY_SEGMENTER_UNAVAILABLE'])
})

it('refuses unvalidated probability fusion strategies', () => {
  const mask = new Uint8Array([1, 1, 1, 1])
  expect(() => fuseSegmentations(mask, mask, 2, 2, [], { strategy: 'probability-weighted' })).toThrow('UNVALIDATED_SEGMENTATION_FUSION_STRATEGY')
})
