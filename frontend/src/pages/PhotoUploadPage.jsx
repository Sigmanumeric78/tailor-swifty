import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ImagePlus, LoaderCircle, ShieldCheck, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { MeasurementEstimateReview } from '../features/cameraScan/components/MeasurementEstimateReview'
import { adjustQualityForWarnings, confidenceBand, overallConfidence } from '../features/cameraScan/geometry/confidence'
import { mergeMeasurementPrefill } from '../features/cameraScan/prefill'
import { PIPELINE_VERSION, scanConfig } from '../features/cameraScan/scanConfig'
import { CameraModelRegistry } from '../features/cameraScan/services/modelRegistry'
import { FrameValidationError, processCaptureRepetitions, validateCapturedFrame } from '../features/cameraScan/services/measurementPipeline'
import { importPhotoFiles, releaseImportedPhoto, releaseImportedPhotos } from '../features/cameraScan/services/photoImportService'
import { useFlow } from '../features/FlowContext'

const guidance = [
  'Keep your full body, head, and both feet inside every frame.',
  'Hold the phone level at approximately waist height and keep the same camera distance.',
  'Wear close-fitting clothing; loose clothing prevents reliable body-dimension recovery.',
  'Front images must face the camera directly. Side images must be a true left or right profile.',
  'Diagonal and arbitrary 360-degree angles are unsupported.',
]

export function PhotoUploadPage() {
  const navigate = useNavigate(); const { flow, updateFlow } = useFlow()
  const [height, setHeight] = useState(''); const [frontPhotos, setFrontPhotos] = useState([]); const [sidePhotos, setSidePhotos] = useState([]); const [clothingFitConfirmed, setClothingFitConfirmed] = useState(false)
  const [phase, setPhase] = useState('selecting'); const [error, setError] = useState(null); const [result, setResult] = useState(null); const [pairCount, setPairCount] = useState(0)
  const photosRef = useRef([]); const registryRef = useRef(null); photosRef.current = [...frontPhotos, ...sidePhotos]
  const forgetPhotos = () => { releaseImportedPhotos(photosRef.current); photosRef.current = []; setFrontPhotos([]); setSidePhotos([]) }
  const cancel = () => { forgetPhotos(); registryRef.current?.dispose(); registryRef.current = null; navigate('/measurements') }
  useEffect(() => () => { releaseImportedPhotos(photosRef.current); registryRef.current?.dispose() }, [])

  const selectFiles = async (view, event) => {
    const input = event.currentTarget; const files = [...(input.files || [])]; setError(null)
    try {
      const current = view === 'front' ? frontPhotos : sidePhotos
      if (current.length + files.length > 3) throw new Error(`${view} photos: select no more than three images.`)
      const imported = await importPhotoFiles(files, [...frontPhotos, ...sidePhotos])
      if (view === 'front') setFrontPhotos((items) => [...items, ...imported]); else setSidePhotos((items) => [...items, ...imported])
    } catch (caught) { setError(caught.message) } finally { input.value = '' }
  }
  const remove = (view, index) => {
    const photos = view === 'front' ? frontPhotos : sidePhotos
    releaseImportedPhoto(photos[index]); const remaining = photos.filter((_, itemIndex) => itemIndex !== index)
    if (view === 'front') setFrontPhotos(remaining); else setSidePhotos(remaining)
  }
  const processPhotos = async () => {
    setError(null)
    const heightMm = Math.round(Number(height) * 10)
    if (!Number.isInteger(heightMm) || heightMm < scanConfig.heightMm.min || heightMm > scanConfig.heightMm.max) return setError('Enter a verified height from 100 to 250 cm.')
    if (!clothingFitConfirmed) return setError('Confirm close-fitting clothing before processing.')
    if (!frontPhotos.length || frontPhotos.length !== sidePhotos.length) return setError('Select the same number of front and side photos, from one to three per view.')
    setPhase('processing'); const registry = new CameraModelRegistry(); registryRef.current = registry
    try {
      await registry.initialize()
      registry.recordRetainedImages(frontPhotos.length + sidePhotos.length)
      const validFront = []; const validSide = []; const rejected = []
      for (let index = 0; index < frontPhotos.length; index += 1) {
        try {
          const front = await validateCapturedFrame(registry, frontPhotos[index], 'front')
          const side = await validateCapturedFrame(registry, sidePhotos[index], 'side')
          validFront.push(front); validSide.push(side)
        } catch (validationError) { rejected.push(validationError) }
      }
      if (!validFront.length) throw rejected[0] || new FrameValidationError({}, 'photo pair', ['SEGMENTATION_MISSING'])
      const cameraMetadataAvailable = validFront.some((item) => Object.keys(item.exif || {}).length > 0) || validSide.some((item) => Object.keys(item.exif || {}).length > 0)
      const processed = await processCaptureRepetitions(registry, validFront, validSide, heightMm, { minimumValid: validFront.length, source: 'photo_estimate', cameraMetadataAvailable, clothingFitConfirmed })
      const rejectedWarnings = rejected.length ? ['PHOTO_PAIR_REJECTED', ...rejected.flatMap((item) => item.reasonCodes || [])] : []
      const measurements = Object.fromEntries(Object.entries(processed.measurements).map(([code, item]) => {
        const warnings = [...new Set([...(item.warnings || []), ...rejectedWarnings])]; const confidence = adjustQualityForWarnings(item.confidence, rejectedWarnings)
        return [code, { ...item, confidence, confidence_level: confidenceBand(confidence), warnings, reason_codes: warnings }]
      }))
      setPairCount(validFront.length); setResult({ ...processed, measurements, overallConfidence: overallConfidence(Object.values(measurements)), warnings: [...new Set([...processed.warnings, ...rejectedWarnings])], heightMm, rejectedPairCount: rejected.length }); forgetPhotos(); registry.dispose(); registryRef.current = null; setPhase('results')
    } catch (caught) { registry.dispose(); registryRef.current = null; forgetPhotos(); setError(caught.message); setPhase('error') }
  }
  const useEstimates = () => {
    updateFlow({ measurements: mergeMeasurementPrefill(flow.measurements, result.measurements, flow.unit), cameraScan: { status: 'photo_review', pipelineVersion: PIPELINE_VERSION, heightMm: result.heightMm, captures: { front: pairCount, side: pairCount }, measurements: result.measurements, overallConfidence: result.overallConfidence, warnings: result.warnings, calibrationMode: 'VERIFIED_HEIGHT' } })
    navigate('/measurements')
  }
  const photoList = (view, photos) => <ul className="photo-file-list">{photos.map((photo, index) => <li key={photo.id}><span>{photo.filename}<small>{photo.width} × {photo.height}px{photo.exif?.focalLengthMm ? ` · EXIF focal length ${photo.exif.focalLengthMm} mm (diagnostic only)` : ' · no usable EXIF calibration metadata'}{photo.exifConsistency === 'inconsistent' ? ' · EXIF dimensions may be stale after editing' : ''}</small></span><button type="button" className="secondary-button icon-button" aria-label={`Remove ${view} photo ${photo.filename}`} onClick={() => remove(view, index)}><Trash2 size={17} aria-hidden="true" /></button></li>)}</ul>

  return <section className="page page-photo-upload">
    <PageHeader eyebrow="Existing-photo scan · Experimental and private" title="Estimate measurements from matched photos." description="Select exact front and profile photos. Files are decoded and processed locally, never uploaded or stored by Tailor Swifty." />
    <Notice tone="warning">These are rough experimental prefills, not validated accuracy. Three independent pairs are recommended. One pair is allowed, but repeatability cannot be assessed.</Notice>
    <div className="photo-privacy"><ShieldCheck size={22} aria-hidden="true" /><p>The application releases browser references to decoded images, but browser memory cannot provide forensic secure erasure. The original gallery files remain on your device.</p></div>
    {phase !== 'results' && <>
      <div className="scan-card"><h2>Photo requirements</h2><ul className="clean-list">{guidance.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <label className="field compact-field">Verified height in centimetres<input aria-label="Verified height in centimetres" type="number" min="100" max="250" step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} /></label>
      <label className="checkbox-row"><input type="checkbox" checked={clothingFitConfirmed} onChange={(event) => setClothingFitConfirmed(event.target.checked)} /> I confirm the person is wearing close-fitting clothing.</label>
      <p>Height calibration is a weak-perspective estimate. EXIF focal length is optional diagnostic evidence and cannot determine metric scale without camera distance.</p>
      <div className="photo-selectors">
        <section className="scan-card"><h2>Front photos</h2><p>One to three directly front-facing images.</p><label className="secondary-button file-button"><ImagePlus size={17} aria-hidden="true" /> Select front photos<input aria-label="Select front photos" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => selectFiles('front', event)} /></label>{photoList('front', frontPhotos)}</section>
        <section className="scan-card"><h2>Side photos</h2><p>One to three true left or right profile images.</p><label className="secondary-button file-button"><ImagePlus size={17} aria-hidden="true" /> Select side photos<input aria-label="Select side photos" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => selectFiles('side', event)} /></label>{photoList('side', sidePhotos)}</section>
      </div>
      {error && <Notice tone="error"><span role="alert">{error}</span></Notice>}
      {phase === 'processing' ? <div className="loading-state" aria-live="polite"><LoaderCircle className="spin" aria-hidden="true" /> Checking and processing photos locally…</div> : <div className="inline-actions"><button type="button" className="primary-button" onClick={processPhotos}>Process photos locally</button><button type="button" className="secondary-button" onClick={cancel}>Cancel and forget photos</button></div>}
    </>}
    {phase === 'results' && result && <><MeasurementEstimateReview measurements={result.measurements} />{pairCount === 1 && <Notice tone="warning">Repeatability was not assessed. Treat these as rough prefills and confirm them manually.</Notice>}{result.rejectedPairCount > 0 && <Notice tone="warning">{result.rejectedPairCount} rejected pair{result.rejectedPairCount === 1 ? ' was' : 's were'} excluded; no measurement was produced from it.</Notice>}<div className="inline-actions"><button type="button" className="primary-button" onClick={useEstimates}>Use estimates and forget photos</button><button type="button" className="secondary-button" onClick={cancel}>Discard results and photos</button></div></>}
    <div className="page-actions"><button type="button" className="secondary-button" onClick={cancel}><ArrowLeft size={17} aria-hidden="true" /> Return to manual measurements</button></div>
  </section>
}
