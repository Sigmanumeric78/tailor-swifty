import { describe, expect, it } from 'vitest'
import { assessExifConsistency, parseExifBuffer, parsePhotoExif } from '../services/photoImportService'

function jpegWithExif() {
  const bytes = new Uint8Array(72); const view = new DataView(bytes.buffer)
  view.setUint16(0, 0xffd8); view.setUint16(2, 0xffe1); view.setUint16(4, 66); bytes.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6)
  const tiff = 12; view.setUint16(tiff, 0x4949); view.setUint16(tiff + 2, 42, true); view.setUint32(tiff + 4, 8, true); view.setUint16(tiff + 8, 3, true)
  const entry = (index, tag, type, value) => { const at = tiff + 10 + index * 12; view.setUint16(at, tag, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, 1, true); if (type === 3) view.setUint16(at + 8, value, true); else view.setUint32(at + 8, value, true) }
  entry(0, 0x0112, 3, 6); entry(1, 0x0100, 4, 4032); entry(2, 0x920a, 5, 50); view.setUint32(tiff + 50, 35, true); view.setUint32(tiff + 54, 10, true)
  return bytes.buffer
}

describe('privacy-local EXIF diagnostics', () => {
  it('parses optional orientation, dimensions, and focal length without inferring scale', () => { expect(parseExifBuffer(jpegWithExif())).toEqual({ orientation: 6, imageWidth: 4032, focalLengthMm: 3.5 }) })
  it('returns empty metadata for stripped and malformed images', async () => {
    expect(parseExifBuffer(new Uint8Array([1, 2, 3]).buffer)).toEqual({}); await expect(parsePhotoExif({ type: 'image/png' })).resolves.toEqual({}); await expect(parsePhotoExif({ type: 'image/jpeg', arrayBuffer: async () => { throw new Error('bad') } })).resolves.toEqual({})
  })
  it('treats absent dimensions as optional and flags stale edited dimensions without blocking', () => {
    expect(assessExifConsistency({}, 1200, 800)).toBe('not-assessable')
    expect(assessExifConsistency({ imageWidth: 4000, imageHeight: 3000 }, 2000, 1500)).toBe('consistent')
    expect(assessExifConsistency({ imageWidth: 4000, imageHeight: 3000 }, 1600, 1600)).toBe('inconsistent')
    expect(assessExifConsistency({ imageWidth: 4000, imageHeight: 3000, orientation: 6 }, 1500, 2000)).toBe('consistent')
  })
})
