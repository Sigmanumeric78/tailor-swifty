import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { useFlow } from '../features/FlowContext'
import { mergeMeasurementPrefill } from '../features/cameraScan/prefill'
import { ServerMeasurementReview } from '../features/cameraScan/components/ServerMeasurementReview'
import { analyzeServerImage, finalizeServerObservations } from '../features/cameraScan/services/serverCameraClient'
import { CAMERA_STREAM_STATE, cameraDisplayName, useCameraStream } from '../features/cameraScan/hooks/useCameraStream'
import { CONSENT_ERROR_CODES, PARTICIPANT_ACCESS_ERROR_CODES, PROCESSING_SESSION_ERROR, useProcessingSession } from '../features/cameraScan/hooks/useProcessingSession'

const privacyCopy = 'Front and side photographs are transmitted securely to an AWS processing function, held only in volatile processing memory, and discarded when each request completes. Tailor Swifty stores only reviewed numeric measurements and processing provenance. Photographs are not retained or used for model training without separate consent.'
const CAMERA_ROUTE = '/measurements/camera'

function normalizedMeasurements(measurements, modelVersions) {
  return Object.fromEntries(Object.entries(measurements).map(([code, item]) => [code, { ...item, confidence: item.quality_score, warnings: item.reason_codes, model_versions: modelVersions }]))
}

function cameraStateCopy(state) {
  return {
    [CAMERA_STREAM_STATE.REQUESTING_PERMISSION]: 'Requesting camera permission',
    [CAMERA_STREAM_STATE.OPENING_STREAM]: 'Opening camera stream',
    [CAMERA_STREAM_STATE.ATTACHING_STREAM]: 'Attaching camera preview',
    [CAMERA_STREAM_STATE.WAITING_FOR_METADATA]: 'Waiting for camera dimensions',
    [CAMERA_STREAM_STATE.WAITING_FOR_FIRST_FRAME]: 'Waiting for the first video frame',
    [CAMERA_STREAM_STATE.SWITCHING_CAMERA]: 'Switching camera',
    [CAMERA_STREAM_STATE.READY]: 'Camera ready',
    [CAMERA_STREAM_STATE.PERMISSION_DENIED]: 'Camera permission denied',
    [CAMERA_STREAM_STATE.UNAVAILABLE]: 'Camera unavailable',
    [CAMERA_STREAM_STATE.ERROR]: 'Camera could not start',
  }[state] || 'Camera stopped'
}

export function ServerCameraScanPage() {
  const navigate = useNavigate(); const { flow, updateFlow } = useFlow(); const camera = useCameraStream()
  const videoRef = useRef(null); const abortRef = useRef(null); const captureStartedRef = useRef(null); const resultReceivedRef = useRef(null)
  const [height, setHeight] = useState(''); const [heightMm, setHeightMm] = useState(null); const [serverConsent, setServerConsent] = useState(false)
  const [view, setView] = useState('FRONT'); const [frontTokens, setFrontTokens] = useState([]); const [sideTokens, setSideTokens] = useState([])
  const [phase, setPhase] = useState('consent'); const [progress, setProgress] = useState('Preparing image'); const [prepared, setPrepared] = useState(null)
  const [error, setError] = useState(null); const [result, setResult] = useState(null); const [selection, setSelection] = useState({ facingMode: 'environment', deviceId: '' })
  const [diagnostics, setDiagnostics] = useState(null)
  const acceptedCount = frontTokens.length + sideTokens.length

  const goToConsent = useCallback((reason) => {
    abortRef.current?.abort(); camera.stop(); setFrontTokens([]); setSideTokens([]); setPrepared(null)
    if (!flow.participant || PARTICIPANT_ACCESS_ERROR_CODES.has(reason?.code)) updateFlow({ participant: null, consented: false })
    navigate('/consent', { state: { returnTo: CAMERA_ROUTE } })
  }, [camera.stop, flow.participant, navigate, updateFlow])
  const expireObservations = useCallback(() => {
    setFrontTokens([]); setSideTokens([]); setPrepared(null); camera.markRecovering(); setPhase('recovering')
  }, [camera.markRecovering])
  const processingSession = useProcessingSession({
    participant: flow.participant,
    heightMm,
    onConsentRequired: goToConsent,
    onObservationsExpired: expireObservations,
  })

  useEffect(() => {
    if (!flow.participant || !flow.consented) goToConsent()
  }, [flow.consented, flow.participant, goToConsent])
  useEffect(() => () => { abortRef.current?.abort(); camera.stop() }, [camera.stop])
  useEffect(() => {
    if (phase !== 'results' || resultReceivedRef.current == null) return undefined
    const frameId = requestAnimationFrame(() => {
      setDiagnostics((current) => ({ ...current, result_render_ms: performance.now() - resultReceivedRef.current }))
      resultReceivedRef.current = null
    })
    return () => cancelAnimationFrame(frameId)
  }, [phase])

  const openCamera = useCallback(async (nextSelection = selection) => {
    abortRef.current?.abort()
    if (acceptedCount > 0) {
      processingSession.clearSession(); setFrontTokens([]); setSideTokens([]); setView('FRONT')
    }
    setPrepared(null); setError(null); setResult(null)
    setPhase('opening_camera')
    try {
      await camera.startReady(videoRef.current, nextSelection)
      setPhase('ready')
    } catch (caught) {
      if (caught?.code !== 'CAMERA_START_CANCELLED') setError(caught.message)
      setPhase('camera_error')
    }
  }, [acceptedCount, camera.startReady, processingSession.clearSession, selection])

  const start = async () => {
    const verifiedHeight = Math.round(Number(height) * 10); setError(null)
    if (!flow.participant || !flow.consented) return goToConsent()
    if (!serverConsent) return setError('Explicit consent is required before camera processing.')
    if (!Number.isInteger(verifiedHeight) || verifiedHeight < 1000 || verifiedHeight > 2500) return setError('Enter a verified height from 100 to 250 cm.')
    try {
      setHeightMm(verifiedHeight); setPhase('recording_consent')
      await api.cameraProcessingConsent(flow.participant.id, flow.participant.participant_access_token)
      await openCamera(selection)
    } catch (caught) {
      if (CONSENT_ERROR_CODES.has(caught?.code) || PARTICIPANT_ACCESS_ERROR_CODES.has(caught?.code) || caught?.code === 'TOKEN_EXPIRED') {
        return goToConsent(caught?.code === 'TOKEN_EXPIRED' ? { code: 'PARTICIPANT_ACCESS_REQUIRED' } : caught)
      }
      camera.stop(); setError(caught.message); setPhase('consent')
    }
  }

  const switchCamera = async (nextSelection) => {
    if (phase === 'processing' || phase === 'finalizing') return
    const pairInvalidated = acceptedCount > 0
    if (pairInvalidated) {
      setFrontTokens([]); setSideTokens([]); processingSession.clearSession()
    }
    setSelection(nextSelection)
    await openCamera(nextSelection)
    if (pairInvalidated) setError('The camera changed, so capture a new matched front and side pair for comparable scale.')
  }

  const capture = async () => {
    const video = videoRef.current
    if (phase !== 'ready' || camera.state !== CAMERA_STREAM_STATE.READY || !video?.videoWidth || !video?.videoHeight) {
      return setError('Wait until the live preview shows a real video frame.')
    }
    const candidateIndex = view === 'FRONT' ? frontTokens.length : sideTokens.length
    const countAtStart = acceptedCount
    abortRef.current = new AbortController(); captureStartedRef.current = performance.now()
    camera.markCapturing(); setError(null); setPrepared(null); setPhase('processing')
    try {
      const response = await processingSession.withValidProcessingSession(
        (activeSession) => analyzeServerImage({
          source: video,
          sessionToken: activeSession.session_token,
          view,
          heightMm,
          candidateIndex,
          captureMetadata: camera.capabilitySnapshot || {},
          signal: abortRef.current.signal,
          onProgress: (nextProgress) => { setProgress(nextProgress); if (nextProgress === 'Sending encrypted request' || nextProgress === 'Checking photograph') camera.markProcessing() },
          onPrepared: setPrepared,
          onTiming: (timing) => setDiagnostics((current) => ({ ...camera.timings, ...current, ...timing })),
        }),
        { acceptedObservationCount: countAtStart },
      )
      if (view === 'FRONT') { setFrontTokens((items) => [...items, response.observation_token]); setView('SIDE') }
      else setSideTokens((items) => [...items, response.observation_token])
      setDiagnostics((current) => ({ ...camera.timings, ...current, total_capture_ms: performance.now() - captureStartedRef.current }))
      camera.markReady(); setPhase('ready')
    } catch (caught) {
      if (CONSENT_ERROR_CODES.has(caught?.code)) return
      setError(caught.result?.highest_priority_correction || caught.message)
      if (caught?.code === PROCESSING_SESSION_ERROR.EXPIRED_WITH_OBSERVATIONS) camera.markRecovering(); else camera.markReady()
      setPhase(caught?.code === PROCESSING_SESSION_ERROR.EXPIRED_WITH_OBSERVATIONS ? 'recovering' : 'ready')
    } finally { abortRef.current = null; captureStartedRef.current = null }
  }

  const finalize = async () => {
    const countAtStart = acceptedCount
    abortRef.current = new AbortController(); camera.markProcessing(); setError(null); setPhase('finalizing'); setProgress('Calculating measurements')
    try {
      const completed = await processingSession.withValidProcessingSession(
        (activeSession) => finalizeServerObservations({ sessionToken: activeSession.session_token, frontTokens, sideTokens, signal: abortRef.current.signal }),
        { acceptedObservationCount: countAtStart },
      )
      resultReceivedRef.current = performance.now()
      setResult({ ...completed, measurements: normalizedMeasurements(completed.measurements, completed.model_versions) })
      setFrontTokens([]); setSideTokens([]); processingSession.clearSession(); camera.stop(); setProgress('Ready for review'); setPhase('results')
    } catch (caught) {
      if (CONSENT_ERROR_CODES.has(caught?.code)) return
      setError(caught.message)
      if (caught?.code === PROCESSING_SESSION_ERROR.EXPIRED_WITH_OBSERVATIONS) camera.markRecovering(); else camera.markReady()
      setPhase(caught?.code === PROCESSING_SESSION_ERROR.EXPIRED_WITH_OBSERVATIONS ? 'recovering' : 'ready')
    } finally { abortRef.current = null }
  }

  const restartCaptureSession = () => {
    processingSession.clearSession(); setFrontTokens([]); setSideTokens([]); setView('FRONT'); setError(null)
    const previewStillReady = Boolean(videoRef.current?.videoWidth && videoRef.current?.videoHeight)
    camera.markReady()
    setPhase(previewStillReady ? 'ready' : 'camera_error')
  }
  const finish = () => {
    updateFlow({ measurements: mergeMeasurementPrefill(flow.measurements, result.measurements, flow.unit), cameraScan: { status: 'server_review', pipelineVersion: result.pipeline_version, measurements: result.measurements, overallConfidence: result.overall_quality_score, warnings: result.reason_codes, calibrationMode: result.calibration_method, captures: {} } })
    setResult(null); navigate('/measurements')
  }
  const cancel = () => {
    abortRef.current?.abort(); camera.stop(); processingSession.clearSession()
    setFrontTokens([]); setSideTokens([]); setPrepared(null); setResult(null); navigate('/measurements')
  }
  const usePhotos = () => {
    abortRef.current?.abort(); camera.stop(); processingSession.clearSession()
    setFrontTokens([]); setSideTokens([]); setPrepared(null); navigate('/measurements/photos')
  }
  const matched = frontTokens.length > 0 && frontTokens.length === sideTokens.length
  const canAddPair = matched && frontTokens.length < 3
  const cameraInterface = !['consent', 'recording_consent', 'results'].includes(phase)
  const captureDisabled = phase !== 'ready' || camera.state !== CAMERA_STREAM_STATE.READY
  const currentFacing = camera.capabilitySnapshot?.facingMode || selection.facingMode

  return <section className="page page-camera-scan">
    <PageHeader eyebrow="Server camera scan · Experimental" title="Capture one front and one profile photograph." description="Each compressed photograph is processed in a separate short-lived AWS Lambda request. Measurement quality has not been commercially validated." />
    <Notice tone="warning">Close-fitting clothing is required. Loose clothing, perspective, camera tilt, lens distortion, and silhouette errors cannot be reliably reversed from ordinary RGB photographs.</Notice>
    <div className="photo-privacy"><ShieldCheck size={22} aria-hidden="true" /><p>{privacyCopy}</p></div>
    {phase === 'consent' && <div className="scan-card"><h2>Start private camera capture</h2><label className="field compact-field">Verified height in centimetres<input type="number" min="100" max="250" step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} /></label><label className="consent-check"><input type="checkbox" checked={serverConsent} onChange={(event) => setServerConsent(event.target.checked)} /><span>I explicitly consent to transmitting one compressed photograph at a time for volatile server processing. I understand failed requests require resubmission because photographs are not stored.</span></label><button type="button" className="primary-button" onClick={start} disabled={!serverConsent}><Camera size={17} aria-hidden="true" /> Start camera</button></div>}
    {phase === 'recording_consent' && <div className="loading-state" role="status">Recording server image-processing consent…</div>}
    <div className="server-camera-viewport" hidden={!cameraInterface}><video ref={videoRef} playsInline muted autoPlay aria-label={view.toLowerCase() + ' camera preview'} /><div className="body-guide" aria-hidden="true" /></div>
    {cameraInterface && <><fieldset className="segmented capture-mode"><legend>Active camera</legend><button type="button" aria-pressed={selection.facingMode === 'environment' && !selection.deviceId} disabled={phase === 'processing' || phase === 'finalizing'} onClick={() => switchCamera({ facingMode: 'environment', deviceId: '' })}>Rear</button><button type="button" aria-pressed={selection.facingMode === 'user' && !selection.deviceId} disabled={phase === 'processing' || phase === 'finalizing'} onClick={() => switchCamera({ facingMode: 'user', deviceId: '' })}>Front</button></fieldset>
      {camera.devices.length > 1 && <label className="field compact-field">Available cameras<select value={selection.deviceId} disabled={phase === 'processing' || phase === 'finalizing'} onChange={(event) => switchCamera({ facingMode: selection.facingMode, deviceId: event.target.value })}><option value="">Automatic {selection.facingMode === 'environment' ? 'rear' : 'front'} camera</option>{camera.devices.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{cameraDisplayName(device, index)}</option>)}</select></label>}
      <p role="status" aria-live="polite">{cameraStateCopy(camera.state)} · requested {selection.facingMode === 'environment' ? 'rear' : 'front'} camera{currentFacing ? ' · active mode: ' + currentFacing : ''}</p>
      <p aria-live="polite">{view === 'FRONT' ? 'Face the camera directly with your full head and feet visible.' : 'Turn to a true left or right profile with your full head and feet visible.'}</p>
      {prepared && <p>Prepared upload: {(prepared.byteSize / 1024).toFixed(0)} KB · {prepared.width} × {prepared.height}px</p>}
      {(phase === 'processing' || phase === 'finalizing') && <div className="loading-state" role="status">{progress}…</div>}
      <button type="button" className="primary-button manual-capture-button" onClick={capture} disabled={captureDisabled}>Capture {view === 'FRONT' ? 'front' : 'side'} photo</button>
      {phase === 'camera_error' && <button type="button" className="secondary-button" onClick={() => openCamera(selection)}>Retry camera</button>}
      {phase === 'recovering' && <button type="button" className="primary-button" onClick={restartCaptureSession}>Restart capture session</button>}
      <p>{frontTokens.length} front and {sideTokens.length} side observations accepted. Tokens remain only in this page’s memory.</p>
      {matched && phase === 'ready' && <div className="inline-actions"><button type="button" className="primary-button" onClick={finalize}>Calculate measurements</button>{canAddPair && <button type="button" className="secondary-button" onClick={() => setView('FRONT')}>Add another matched pair</button>}</div>}
      {import.meta.env.DEV && diagnostics && <details><summary>Local timing diagnostics</summary><pre>{JSON.stringify(diagnostics, null, 2)}</pre></details>}
    </>}
    {phase === 'results' && result && <div className="scan-card"><h2>Ready for manual review</h2><ServerMeasurementReview result={result} /><button type="button" className="primary-button" onClick={finish}>Use reviewed numeric estimates</button></div>}
    {error && <Notice tone="error"><span role="alert">{error}</span></Notice>}
    <div className="page-actions"><button type="button" className="secondary-button" onClick={cancel}><ArrowLeft size={17} aria-hidden="true" /> Cancel and return to manual measurements</button><button type="button" className="secondary-button" onClick={usePhotos}>Use existing photos</button></div>
  </section>
}
