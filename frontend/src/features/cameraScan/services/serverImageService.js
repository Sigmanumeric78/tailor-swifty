import { parsePhotoExif } from './photoImportService'
import { serverImageConfig } from '../serverConfig'

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas
}

function sourceDimensions(source) {
  return { width: source.videoWidth || source.width || 0, height: source.videoHeight || source.height || 0 }
}

async function canvasBlob(canvas, mimeType, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: mimeType, quality })
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('IMAGE_COMPRESSION_FAILED')), mimeType, quality))
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const block = 0x8000
  for (let index = 0; index < bytes.length; index += block) binary += String.fromCharCode(...bytes.subarray(index, index + block))
  return btoa(binary)
}

/** Canvas encoding applies browser-decoded orientation and strips source EXIF/hidden metadata. */
export async function prepareServerImage(source, { mimeType = 'image/jpeg', onProgress = () => {} } = {}) {
  onProgress('Preparing image')
  let bitmap = null; let canvas = null; let context = null; let blob = null
  try {
    const isFile = typeof File !== 'undefined' && source instanceof File
    if (isFile) {
      if (!['image/jpeg', 'image/webp'].includes(source.type)) throw new Error('Use a JPEG or WebP photograph.')
      await parsePhotoExif(source) // parsed locally for orientation diagnostics; never transmitted
      bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' })
    }
    const drawable = bitmap || source
    const dimensions = sourceDimensions(drawable)
    if (!dimensions.width || !dimensions.height) throw new Error('The image has invalid dimensions.')
    const scale = Math.min(1, serverImageConfig.preferredLongEdge / Math.max(dimensions.width, dimensions.height))
    const width = Math.max(1, Math.round(dimensions.width * scale)); const height = Math.max(1, Math.round(dimensions.height * scale))
    canvas = createCanvas(width, height); context = canvas.getContext('2d')
    if (!context) throw new Error('Image preparation is unavailable in this browser.')
    context.drawImage(drawable, 0, 0, width, height)
    onProgress('Compressing image')
    for (let quality = serverImageConfig.initialQuality; quality >= serverImageConfig.minimumQuality - 0.001; quality -= serverImageConfig.qualityStep) {
      blob = await canvasBlob(canvas, mimeType, quality)
      if (blob.size <= serverImageConfig.maximumCompressedBytes) break
      blob = null
    }
    if (!blob || blob.size > serverImageConfig.maximumCompressedBytes) throw new Error('The photograph could not be compressed below 2.5 MB.')
    const imageBase64 = await blobToBase64(blob)
    const requestEstimate = imageBase64.length + 2048
    if (requestEstimate > serverImageConfig.maximumRequestBytes) throw new Error('The prepared request exceeds the 4.5 MB limit.')
    return { imageBase64, mimeType: blob.type || mimeType, byteSize: blob.size, width, height }
  } finally {
    bitmap?.close?.()
    context?.clearRect?.(0, 0, canvas?.width || 0, canvas?.height || 0)
    if (canvas) { canvas.width = 0; canvas.height = 0 }
    blob = null
  }
}
