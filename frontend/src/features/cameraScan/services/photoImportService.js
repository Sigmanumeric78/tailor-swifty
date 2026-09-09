export const supportedPhotoTypes = Object.freeze(['image/jpeg', 'image/png', 'image/webp'])
export const maximumEncodedBytes = 15 * 1024 * 1024
export const maximumDecodedPixels = 24_000_000
export const maximumProcessedDimension = 2048

export class PhotoImportError extends Error {
  constructor(code, message) { super(message); this.name = 'PhotoImportError'; this.code = code }
}

export function photoFingerprint(file) {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}`
}

export function validatePhotoFileMetadata(file, existingFingerprints = new Set()) {
  const filename = file?.name || 'selected file'
  const lowerName = filename.toLowerCase()
  if (file?.type === 'image/heic' || file?.type === 'image/heif' || lowerName.endsWith('.heic') || lowerName.endsWith('.heif')) throw new PhotoImportError('HEIC_UNSUPPORTED', 'Please convert HEIC/HEIF to JPEG, PNG, or WebP before selecting it.')
  if (!supportedPhotoTypes.includes(file?.type)) throw new PhotoImportError('UNSUPPORTED_TYPE', 'Select a JPEG, PNG, or WebP image.')
  if (!Number.isFinite(file.size) || file.size <= 0) throw new PhotoImportError('CORRUPT_IMAGE', 'The selected image is empty or corrupt.')
  if (file.size > maximumEncodedBytes) throw new PhotoImportError('FILE_TOO_LARGE', 'Encoded images must be 15 MB or smaller.')
  const fingerprint = photoFingerprint(file)
  if (existingFingerprints.has(fingerprint)) throw new PhotoImportError('DUPLICATE_PHOTO', 'This image is already selected. Choose an independent view.')
  return fingerprint
}

function readExifValue(view, entryOffset, littleEndian, tiffStart) {
  const type = view.getUint16(entryOffset + 2, littleEndian); const count = view.getUint32(entryOffset + 4, littleEndian)
  const typeSize = { 2: 1, 3: 2, 4: 4, 5: 8 }[type]
  if (!typeSize || count < 1) return null
  const valueOffset = typeSize * count <= 4 ? entryOffset + 8 : tiffStart + view.getUint32(entryOffset + 8, littleEndian)
  if (valueOffset < 0 || valueOffset + typeSize > view.byteLength) return null
  if (type === 2) {
    let value = ''
    for (let index = 0; index < count && valueOffset + index < view.byteLength; index += 1) { const byte = view.getUint8(valueOffset + index); if (!byte) break; value += String.fromCharCode(byte) }
    return value || null
  }
  if (type === 3) return view.getUint16(valueOffset, littleEndian)
  if (type === 4) return view.getUint32(valueOffset, littleEndian)
  const denominator = view.getUint32(valueOffset + 4, littleEndian)
  return denominator ? view.getUint32(valueOffset, littleEndian) / denominator : null
}

function readIfd(view, offset, littleEndian, tiffStart, output, depth = 0) {
  if (depth > 2 || offset < 0 || offset + 2 > view.byteLength) return
  const count = view.getUint16(offset, littleEndian)
  if (count > 256 || offset + 2 + count * 12 > view.byteLength) return
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 2 + index * 12; const tag = view.getUint16(entry, littleEndian); const value = readExifValue(view, entry, littleEndian, tiffStart)
    if (tag === 0x0112) output.orientation = value
    else if (tag === 0x0100 || tag === 0xa002) output.imageWidth = value
    else if (tag === 0x0101 || tag === 0xa003) output.imageHeight = value
    else if (tag === 0x920a) output.focalLengthMm = value
    else if (tag === 0xa405) output.focalLength35mm = value
    else if (tag === 0xa404) output.digitalZoomRatio = value
    else if (tag === 0x0132 || tag === 0x9003) output.timestamp = value
    else if (tag === 0x8769 && Number.isInteger(value)) readIfd(view, tiffStart + value, littleEndian, tiffStart, output, depth + 1)
  }
}

/** Parse optional JPEG EXIF locally. Values are diagnostics, never authoritative scale. */
export function parseExifBuffer(buffer) {
  try {
    const view = new DataView(buffer); if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return {}
    let offset = 2
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break
      const marker = view.getUint8(offset + 1); const length = view.getUint16(offset + 2)
      if (length < 2 || offset + 2 + length > view.byteLength) break
      if (marker === 0xe1 && length >= 14 && view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
        const tiffStart = offset + 10; const byteOrder = view.getUint16(tiffStart); const littleEndian = byteOrder === 0x4949
        if ((!littleEndian && byteOrder !== 0x4d4d) || view.getUint16(tiffStart + 2, littleEndian) !== 42) return {}
        const output = {}; readIfd(view, tiffStart + view.getUint32(tiffStart + 4, littleEndian), littleEndian, tiffStart, output)
        return output
      }
      offset += 2 + length
    }
  } catch { return {} }
  return {}
}

export async function parsePhotoExif(file) {
  if (file?.type !== 'image/jpeg' || typeof file.arrayBuffer !== 'function') return {}
  try { return parseExifBuffer(await file.arrayBuffer()) } catch { return {} }
}

/** EXIF dimensions are optional diagnostics and may describe a pre-edit/crop source. */
export function assessExifConsistency(exif, decodedWidth, decodedHeight) {
  if (!exif?.imageWidth || !exif?.imageHeight) return 'not-assessable'
  const orientationSwapsAxes = [5, 6, 7, 8].includes(exif.orientation)
  const expectedWidth = orientationSwapsAxes ? exif.imageHeight : exif.imageWidth
  const expectedHeight = orientationSwapsAxes ? exif.imageWidth : exif.imageHeight
  const widthRatio = decodedWidth / expectedWidth; const heightRatio = decodedHeight / expectedHeight
  return Math.abs(widthRatio - heightRatio) <= 0.02 * Math.max(widthRatio, heightRatio) ? 'consistent' : 'inconsistent'
}

function processingCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas
}

export async function decodePhotoFile(file, existingFingerprints = new Set()) {
  const fingerprint = validatePhotoFileMetadata(file, existingFingerprints)
  if (typeof createImageBitmap !== 'function') throw new PhotoImportError('DECODER_UNAVAILABLE', 'This browser cannot safely decode selected photos in memory. Use live camera or manual measurement.')
  let original; let normalized; let canvas; let context
  try {
    const exif = await parsePhotoExif(file)
    original = await createImageBitmap(file, { imageOrientation: 'from-image' })
    if (!original.width || !original.height) throw new PhotoImportError('CORRUPT_IMAGE', 'The decoded image has invalid dimensions.')
    if (original.width * original.height > maximumDecodedPixels) throw new PhotoImportError('IMAGE_TOO_LARGE', 'Decoded image resolution must not exceed 24 megapixels.')
    const scale = Math.min(1, maximumProcessedDimension / Math.max(original.width, original.height))
    const width = Math.max(1, Math.round(original.width * scale)); const height = Math.max(1, Math.round(original.height * scale))
    canvas = processingCanvas(width, height); context = canvas.getContext('2d')
    if (!context) throw new PhotoImportError('DECODER_UNAVAILABLE', 'This browser cannot safely normalize selected photos in memory.')
    context.drawImage(original, 0, 0, width, height)
    normalized = await createImageBitmap(canvas)
    if (!normalized.width || !normalized.height) throw new PhotoImportError('CORRUPT_IMAGE', 'Image normalization produced invalid dimensions.')
    return { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, filename: file.name, mimeType: file.type, encodedBytes: file.size, width, height, fingerprint, exif, exifConsistency: assessExifConsistency(exif, original.width, original.height), bitmap: normalized }
  } catch (error) {
    normalized?.close?.()
    if (error instanceof PhotoImportError) throw error
    throw new PhotoImportError('CORRUPT_IMAGE', 'The selected image could not be decoded.')
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

export function releaseImportedPhoto(photo) {
  if (!photo || photo.released) return
  photo.bitmap?.close?.(); photo.released = true
}
export function releaseImportedPhotos(photos = []) { photos.forEach(releaseImportedPhoto) }
