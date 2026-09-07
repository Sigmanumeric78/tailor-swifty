import { expect, it } from 'vitest'
import { compareSilhouettes, maskIoU } from '../services/silhouetteConsensus'

it('reports exact agreement and flags silhouette disagreement', () => {
  const first = new Uint8Array(100); const second = new Uint8Array(100)
  for (let y = 2; y < 8; y += 1) for (let x = 3; x < 7; x += 1) first[y * 10 + x] = second[y * 10 + x] = 1
  expect(maskIoU(first, second)).toBe(1)
  second.fill(0); for (let y = 2; y < 8; y += 1) for (let x = 6; x < 9; x += 1) second[y * 10 + x] = 1
  expect(compareSilhouettes(first, second, 10, 10, [4, 6])).toMatchObject({ passed: false, reasonCodes: ['SILHOUETTE_DISAGREEMENT'] })
})
