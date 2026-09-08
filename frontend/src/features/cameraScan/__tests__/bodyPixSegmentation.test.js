import { describe, expect, it } from 'vitest'
import { binaryMaskFromRgba } from '../services/bodyPixSegmentationService'

describe('BodyPix RGBA conversion', () => {
  it('uses one alpha value per output pixel', () => {
    const rgba = { width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 255]) }
    expect([...binaryMaskFromRgba(rgba, .65)]).toEqual([0, 1])
  })

  it('rejects malformed RGBA buffers', () => {
    expect(() => binaryMaskFromRgba({ width: 2, height: 1, data: new Uint8ClampedArray(7) }, .65)).toThrow(/invalid RGBA mask/)
  })
})
