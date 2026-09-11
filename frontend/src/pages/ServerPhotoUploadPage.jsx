import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ImagePlus, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { useFlow } from '../features/FlowContext'
import { mergeMeasurementPrefill } from '../features/cameraScan/prefill'
import { ServerMeasurementReview } from '../features/cameraScan/components/ServerMeasurementReview'
import { analyzeServerImage, finalizeServerObservations } from '../features/cameraScan/services/serverCameraClient'
import { CONSENT_ERROR_CODES, PARTICIPANT_ACCESS_ERROR_CODES, PROCESSING_SESSION_ERROR, useProcessingSession } from '../features/cameraScan/hooks/useProcessingSession'

const privacyCopy = 'Front and side photographs are transmitted securely to an AWS processing function, held only in volatile processing memory, and discarded when each request completes. Tailor Swifty stores only reviewed numeric measurements and processing provenance. Photographs are not retained or used for model training without separate consent.'
const PHOTO_ROUTE = '/measurements/photos'
const normalize = (measurements, modelVersions) => Object.fromEntries(Object.entries(measurements).map(([code, item]) => [code, { ...item, confidence: item.quality_score, warnings: item.reason_codes, model_versions: modelVersions }]))

export function ServerPhotoUploadPage() {
  const navigate = useNavigate(); const { flow, updateFlow } = useFlow(); const abortRef = useRef(null)
  const [height, setHeight] = useState(''); const [heightMm, setHeightMm] = useState(null); const [consent, setConsent] = useState(false)
  const [frontTokens, setFrontTokens] = useState([]); const [sideTokens, setSideTokens] = useState([]); const [phase, setPhase] = useState('consent')
  const [progress, setProgress] = useState('Preparing image'); const [prepared, setPrepared] = useState(null); const [error, setError] = useState(null); const [result, setResult] = useState(null)
  const acceptedCount = frontTokens.length + sideTokens.length

  const goToConsent = useCallback((reason) => {
    abortRef.current?.abort(); setFrontTokens([]); setSideTokens([]); setPrepared(null)
    if (!flow.participant || PARTICIPANT_ACCESS_ERROR_CODES.has(reason?.code)) updateFlow({ participant: null, consented: false })
    navigate('/consent', { state: { returnTo: PHOTO_ROUTE } })
  }, [flow.participant, navigate, updateFlow])
  const expireObservations = useCallback(() => {
    setFrontTokens([]); setSideTokens([]); setPrepared(null); setPhase('recovering')
  }, [])
  const processingSession = useProcessingSession({
    participant: flow.participant,
    heightMm,
    onConsentRequired: goToConsent,
    onObservationsExpired: expireObservations,
  })

  useEffect(() => {
    if (!flow.participant || !flow.consented) goToConsent()
  }, [flow.consented, flow.participant, goToConsent])
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const start = async () => {
    const verifiedHeight = Math.round(Number(height) * 10); setError(null)
    if (!flow.participant || !flow.consented) return goToConsent()
    if (!consent) return setError('Explicit server image-processing consent is required.')
    if (!Number.isInteger(verifiedHeight) || verifiedHeight < 1000 || verifiedHeight > 2500) return setError('Enter a verified height from 100 to 250 cm.')
    try {
      setPhase('recording_consent')
      await api.cameraProcessingConsent(flow.participant.id, flow.participant.participant_access_token)
      setHeightMm(verifiedHeight); setPhase('selecting')
    } catch (caught) {
      if (CONSENT_ERROR_CODES.has(caught?.code) || PARTICIPANT_ACCESS_ERROR_CODES.has(caught?.code) || caught?.code === 'TOKEN_EXPIRED') {
        return goToConsent(caught?.code === 'TOKEN_EXPIRED' ? { code: 'PARTICIPANT_ACCESS_REQUIRED' } : caught)
      }
      setError(caught.message); setPhase('consent')
    }
  }

  const select = async (view, event) => {
    const input = event.currentTarget; const file = input.files?.[0]; input.value = ''
    if (!file || phase === 'processing') return
    const tokens = view === 'FRONT' ? frontTokens : sideTokens
    if (tokens.length >= 3) return setError('No more than three ' + view.toLowerCase() + ' candidates are allowed.')
    const countAtStart = acceptedCount
    abortRef.current = new AbortController(); setPrepared(null); setError(null); setPhase('processing')
    try {
      const response = await processingSession.withValidProcessingSession(
        (activeSession) => analyzeServerImage({
          source: file,
          sessionToken: activeSession.session_token,
          view,
          heightMm,
          candidateIndex: tokens.length,
          signal: abortRef.current.signal,
          onProgress: setProgress,
          onPrepared: setPrepared,
        }),
        { acceptedObservationCount: countAtStart },
      )
      if (view === 'FRONT') setFrontTokens((items) => [...items, response.observation_token])
      else setSideTokens((items) => [...items, response.observation_token])
      setPhase('selecting')
    } catch (caught) {
      if (CONSENT_ERROR_CODES.has(caught?.code)) return
      setError(view + ': ' + (caught.result?.highest_priority_correction || caught.message))
      setPhase(caught?.code === PROCESSING_SESSION_ERROR.EXPIRED_WITH_OBSERVATIONS ? 'recovering' : 'selecting')
    } finally { abortRef.current = null }
  }

  const finalize = async () => {
    const countAtStart = acceptedCount
    abortRef.current = new AbortController(); setPhase('processing'); setProgress('Calculating measurements'); setError(null)
    try {
      const completed = await processingSession.withValidProcessingSession(
        (activeSession) => finalizeServerObservations({ sessionToken: activeSession.session_token, frontTokens, sideTokens, signal: abortRef.current.signal }),
        { acceptedObservationCount: countAtStart },
      )
      setResult({ ...completed, measurements: normalize(completed.measurements, completed.model_versions) })
      setFrontTokens([]); setSideTokens([]); processingSession.clearSession(); setPhase('results')
    } catch (caught) {
      if (CONSENT_ERROR_CODES.has(caught?.code)) return
      setError(caught.message)
      setPhase(caught?.code === PROCESSING_SESSION_ERROR.EXPIRED_WITH_OBSERVATIONS ? 'recovering' : 'selecting')
    } finally { abortRef.current = null }
  }
  const restartCaptureSession = () => {
    processingSession.clearSession(); setFrontTokens([]); setSideTokens([]); setPrepared(null); setError(null); setPhase('selecting')
  }
  const cancel = () => {
    abortRef.current?.abort(); processingSession.clearSession(); setFrontTokens([]); setSideTokens([]); setPrepared(null); setResult(null); navigate('/measurements')
  }
  const finish = () => {
    updateFlow({ measurements: mergeMeasurementPrefill(flow.measurements, result.measurements, flow.unit), cameraScan: { status: 'server_photo_review', pipelineVersion: result.pipeline_version, measurements: result.measurements, overallConfidence: result.overall_quality_score, warnings: result.reason_codes, calibrationMode: result.calibration_method, captures: {} } })
    setResult(null); navigate('/measurements')
  }
  const matched = frontTokens.length > 0 && frontTokens.length === sideTokens.length

  return <section className="page page-photo-upload">
    <PageHeader eyebrow="Server photo scan · Experimental" title="Process matched front and profile photographs." description="Each selected file is oriented, resized, stripped of EXIF, compressed, sent alone, and released before another photograph is selected." />
    <Notice tone="warning">Use one to three independent matched pairs. Full head and feet must be visible; diagonal views are unsupported; close-fitting clothing is required.</Notice>
    <div className="photo-privacy"><ShieldCheck size={22} aria-hidden="true" /><p>{privacyCopy}</p></div>
    {phase === 'consent' && <div className="scan-card"><label className="field compact-field">Verified height in centimetres<input type="number" min="100" max="250" step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} /></label><label className="consent-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I explicitly consent to one-at-a-time HTTPS transmission for volatile AWS Lambda processing. Failed requests require selecting the photograph again because it is not retained.</span></label><button type="button" className="primary-button" disabled={!consent} onClick={start}>Continue to existing photos</button></div>}
    {phase === 'recording_consent' && <div className="loading-state" role="status">Recording server image-processing consent…</div>}
    {['selecting', 'processing'].includes(phase) && <div className="photo-selectors"><section className="scan-card"><h2>Front candidates</h2><p>{frontTokens.length}/3 accepted.</p><label className="secondary-button file-button"><ImagePlus size={17} aria-hidden="true" /> Select one front JPEG, PNG, or WebP<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Select one front JPEG, PNG, or WebP" onChange={(event) => select('FRONT', event)} disabled={phase === 'processing' || frontTokens.length >= 3} /></label></section><section className="scan-card"><h2>Profile candidates</h2><p>{sideTokens.length}/3 accepted.</p><label className="secondary-button file-button"><ImagePlus size={17} aria-hidden="true" /> Select one profile JPEG, PNG, or WebP<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Select one profile JPEG, PNG, or WebP" onChange={(event) => select('SIDE', event)} disabled={phase === 'processing' || sideTokens.length >= 3} /></label></section></div>}
    {prepared && <p>Prepared upload: {(prepared.byteSize / 1024).toFixed(0)} KB · {prepared.width} × {prepared.height}px</p>}
    {phase === 'processing' && <div className="loading-state" role="status">{progress}…</div>}
    {phase === 'recovering' && <button type="button" className="primary-button" onClick={restartCaptureSession}>Restart capture session</button>}
    {matched && phase === 'selecting' && <button type="button" className="primary-button" onClick={finalize}>Calculate measurements from {frontTokens.length} matched pair{frontTokens.length === 1 ? '' : 's'}</button>}
    {phase === 'results' && result && <div className="scan-card"><h2>Ready for manual review</h2><ServerMeasurementReview result={result} /><button type="button" className="primary-button" onClick={finish}>Use reviewed numeric estimates</button></div>}
    {error && <Notice tone="error"><span role="alert">{error}</span></Notice>}
    <div className="page-actions"><button type="button" className="secondary-button" onClick={cancel}><ArrowLeft size={17} aria-hidden="true" /> Cancel and forget this session</button></div>
  </section>
}
