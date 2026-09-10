import { afterEach, expect, it, vi } from 'vitest'
import { prepareServerImage } from '../services/serverImageService'

function installCanvas(blobs) {
  const context = { drawImage: vi.fn(), clearRect: vi.fn() }
  const instances = []
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(width, height) { this.width = width; this.height = height; this.context = context; instances.push(this) }
    getContext() { return this.context }
    convertToBlob() { return Promise.resolve(blobs.shift()) }
  })
  return { context, instances }
}

function encodedBlob(size, value = 7) {
  const bytes = new Uint8Array(size).fill(value)
  return { size, type: 'image/jpeg', arrayBuffer: async () => bytes.buffer }
}

afterEach(() => vi.unstubAllGlobals())

it('applies decoded orientation, resizes a large photo, strips source bytes, and closes the bitmap', async () => {
  const original = new File([new TextEncoder().encode('EXIF-private-metadata')], 'private.jpg', { type: 'image/jpeg' })
  const bitmap = { width: 4000, height: 3000, close: vi.fn() }; vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
  const encoded = encodedBlob(120_000); installCanvas([encoded])
  const prepared = await prepareServerImage(original)
  expect(createImageBitmap).toHaveBeenCalledWith(original, { imageOrientation: 'from-image' })
  expect(Math.max(prepared.width, prepared.height)).toBe(1280)
  expect(prepared.byteSize).toBeLessThan(2_500_000)
  expect(atob(prepared.imageBase64)).not.toContain('EXIF-private-metadata')
  expect(bitmap.close).toHaveBeenCalledOnce()
})

it('reduces encoding quality until the payload is below the configured limit and clears the canvas', async () => {
  const large = encodedBlob(2_500_001); const small = encodedBlob(300_000)
  const { context, instances } = installCanvas([large, small])
  const prepared = await prepareServerImage({ width: 1600, height: 1200 })
  expect(prepared.byteSize).toBe(300_000)
  expect(context.clearRect).toHaveBeenCalledOnce()
  expect(instances[0].width).toBe(0); expect(instances[0].height).toBe(0)
})
