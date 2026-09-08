export const supportedPhotoTypes = Object.freeze(['image/jpeg', 'image/png', 'image/webp'])
export const maximumEncodedBytes = 15 * 1024 * 1024
export const maximumDecodedPixels = 24_000_000
export const maximumProcessedDimension = 2048

export class PhotoImportError extends Error {
  constructor(code, message, filename) { super(message); this.name = 'PhotoImportError'; this.code = code; this.filename = filename }
}

export function photoFingerprint(file) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`
}

export function validatePhotoFileMetadata(file, existingFingerprints = new Set()) {
  const filename = file?.name || 'selected file'
  const lowerName = filename.toLowerCase()
  if (file?.type === 'image/heic' || file?.type === 'image/heif' || lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) throw new PhotoImportError('HEIC_UNSUPPORTED', `${filename}: convert HEIC/HEIF to JPEG, PNG, or WebP before selecting it.`, filename)
  if (!supportedPhotoTypes.includes(file?.type)) throw new PhotoImportError('UNSUPPORTED_TYPE', `${filename}: select a JPEG, PNG, or WebP image.`, filename)
  if (!Number.isFinite(file.size) || file.size <= 0) throw new PhotoImportError('CORRUPT_IMAGE', `${filename}: the image is empty or corrupt.`, filename)
  if (file.size > maximumEncodedBytes) throw new PhotoImportError('FILE_TOO_LARGE', `${filename}: encoded files must be 15 MB or smaller.`, filename)
  const fingerprint = photoFingerprint(file)
  if (existingFingerprints.has(fingerprint)) throw new PhotoImportError('DUPLICATE_PHOTO', `${filename}: this file is already selected. Choose an independent view.`, filename)
  return fingerprint
}

function processingCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas
}

export async function decodePhotoFile(file, existingFingerprints = new Set()) {
  const fingerprint = validatePhotoFileMetadata(file, existingFingerprints)
  if (typeof createImageBitmap !== 'function') throw new PhotoImportError('DECODER_UNAVAILABLE', 'This browser cannot safely decode selected photos in memory. Use live camera or manual measurement.', file.name)
  let original; let normalized; let canvas; let context
  try {
    original = await createImageBitmap(file, { imageOrientation: 'from-image' })
    if (!original.width || !original.height) throw new PhotoImportError('CORRUPT_IMAGE', `${file.name}: the decoded image has invalid dimensions.`, file.name)
    if (original.width * original.height > maximumDecodedPixels) throw new PhotoImportError('IMAGE_TOO_LARGE', `${file.name}: decoded resolution must not exceed 24 megapixels.`, file.name)
    const scale = Math.min(1, maximumProcessedDimension / Math.max(original.width, original.height))
    const width = Math.max(1, Math.round(original.width * scale)); const height = Math.max(1, Math.round(original.height * scale))
    canvas = processingCanvas(width, height); context = canvas.getContext('2d')
    if (!context) throw new PhotoImportError('DECODER_UNAVAILABLE', 'This browser cannot safely normalize selected photos in memory.', file.name)
    context.drawImage(original, 0, 0, width, height)
    normalized = await createImageBitmap(canvas)
    if (!normalized.width || !normalized.height) throw new PhotoImportError('CORRUPT_IMAGE', `${file.name}: normalization produced invalid dimensions.`, file.name)
    return { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, filename: file.name, mimeType: file.type, encodedBytes: file.size, width, height, fingerprint, bitmap: normalized }
  } catch (error) {
    normalized?.close?.()
    if (error instanceof PhotoImportError) throw error
    throw new PhotoImportError('CORRUPT_IMAGE', `${file.name}: the image could not be decoded.`, file.name)
  } finally {
    context?.clearRect(0, 0, canvas.width, canvas.height); if (canvas) { canvas.width = 0; canvas.height = 0 }
    original?.close?.()
  }
}

export async function importPhotoFiles(files, existingPhotos = []) {
  const imported = []; const fingerprints = new Set(existingPhotos.map((photo) => photo.fingerprint))
  try {
    for (const file of files) { const photo = await decodePhotoFile(file, fingerprints); imported.push(photo); fingerprints.add(photo.fingerprint) }
    return imported
  } catch (error) { releaseImportedPhotos(imported); throw error }
}

export function releaseImportedPhoto(photo) { photo?.bitmap?.close?.() }
export function releaseImportedPhotos(photos = []) { photos.forEach(releaseImportedPhoto) }
