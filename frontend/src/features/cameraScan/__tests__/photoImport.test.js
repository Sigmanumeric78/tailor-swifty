import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decodePhotoFile,
  importPhotoFiles,
  maximumEncodedBytes,
  releaseImportedPhoto,
  supportedPhotoTypes,
  validatePhotoFileMetadata,
} from '../services/photoImportService'

const file = (name, type, size = 100, lastModified = 1) => ({ name, type, size, lastModified })

function mockDecoder(width = 1200, height = 1800) {
  const original = { width, height, close: vi.fn() }
  const normalized = { width: Math.min(width, 1365), height: Math.min(height, 2048), close: vi.fn() }
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(canvasWidth, canvasHeight) { this.width = canvasWidth; this.height = canvasHeight; this.context = { drawImage: vi.fn(), clearRect: vi.fn() } }
    getContext() { return this.context }
  })
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(normalized))
  return { original, normalized }
}

afterEach(() => vi.unstubAllGlobals())

describe('private photo import', () => {
  it('accepts only JPEG, PNG, and WebP metadata', () => {
    supportedPhotoTypes.forEach((type, index) => expect(validatePhotoFileMetadata(file(`photo-${index}`, type))).toBeTruthy())
    expect(() => validatePhotoFileMetadata(file('photo.gif', 'image/gif'))).toThrow(/JPEG, PNG, or WebP/)
  })

  it('rejects HEIC with conversion guidance without copying the filename into the error', () => {
    expect.assertions(3)
    try { validatePhotoFileMetadata(file('private-name.HEIC', 'image/heic')) } catch (error) { expect(error.message).toMatch(/convert HEIC\/HEIF/); expect(error.message).not.toContain('private-name'); expect(error).not.toHaveProperty('filename') }
  })
  it('rejects oversized encoded images', () => { expect(() => validatePhotoFileMetadata(file('large.jpg', 'image/jpeg', maximumEncodedBytes + 1))).toThrow(/15 MB/) })
  it('rejects duplicate file metadata', () => { const selected = file('same.jpg', 'image/jpeg'); expect(() => validatePhotoFileMetadata(selected, new Set([validatePhotoFileMetadata(selected)]))).toThrow(/already selected/) })

  it('applies orientation, normalizes dimensions, and closes the original bitmap', async () => {
    const { original, normalized } = mockDecoder()
    const photo = await decodePhotoFile(file('valid.jpg', 'image/jpeg'))
    expect(createImageBitmap).toHaveBeenNthCalledWith(1, expect.anything(), { imageOrientation: 'from-image' })
    expect(Math.max(photo.width, photo.height)).toBeLessThanOrEqual(2048)
    expect(photo).toMatchObject({ width: 1200, height: 1800 })
    expect(original.close).toHaveBeenCalledOnce()
    releaseImportedPhoto(photo)
    expect(normalized.close).toHaveBeenCalledOnce()
  })

  it('rejects oversized decoded resolution and closes the bitmap', async () => {
    const { original } = mockDecoder(6000, 5000)
    await expect(decodePhotoFile(file('huge.png', 'image/png'))).rejects.toThrow(/24 megapixels/)
    expect(original.close).toHaveBeenCalledOnce()
  })

  it('rejects corrupt and zero-dimension images', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failure')))
    await expect(decodePhotoFile(file('corrupt.webp', 'image/webp'))).rejects.toThrow(/could not be decoded/)
    const zero = { width: 0, height: 0, close: vi.fn() }
    createImageBitmap.mockResolvedValueOnce(zero)
    await expect(decodePhotoFile(file('zero.png', 'image/png'))).rejects.toThrow(/invalid dimensions/)
    expect(zero.close).toHaveBeenCalledOnce()
  })

  it('closes already decoded photos when a later file fails', async () => {
    const { normalized } = mockDecoder()
    await expect(importPhotoFiles([file('valid.jpg', 'image/jpeg'), file('bad.gif', 'image/gif')])).rejects.toThrow()
    expect(normalized.close).toHaveBeenCalledOnce()
  })

  it('does not use network, persistent storage, blob URLs, or browser caches while decoding', async () => {
    mockDecoder(); const fetch = vi.fn(); const xhr = vi.fn(); const socket = vi.fn(); const objectUrl = vi.fn(); const local = vi.spyOn(Storage.prototype, 'setItem')
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('XMLHttpRequest', xhr); vi.stubGlobal('WebSocket', socket); vi.stubGlobal('URL', { createObjectURL: objectUrl })
    const sendBeacon = vi.fn(); Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon })
    const photo = await decodePhotoFile(file('local.png', 'image/png')); releaseImportedPhoto(photo)
    expect(fetch).not.toHaveBeenCalled(); expect(xhr).not.toHaveBeenCalled(); expect(socket).not.toHaveBeenCalled(); expect(sendBeacon).not.toHaveBeenCalled(); expect(objectUrl).not.toHaveBeenCalled(); expect(local).not.toHaveBeenCalled()
  })
})
