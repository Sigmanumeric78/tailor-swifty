import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { useFlow } from '../features/FlowContext'
import { mergeMeasurementPrefill } from '../features/cameraScan/prefill'
import { ServerMeasurementReview } from '../features/cameraScan/components/ServerMeasurementReview'
import { SERVER_PIPELINE_VERSION } from '../features/cameraScan/serverConfig'
import { analyzeServerImage, finalizeServerObservations } from '../features/cameraScan/services/serverCameraClient'
import { useCameraStream } from '../features/cameraScan/hooks/useCameraStream'

const privacyCopy = 'Front and side photographs are transmitted securely to an AWS processing function, held only in volatile processing memory, and discarded when each request completes. Tailor Swifty stores only reviewed numeric measurements and processing provenance. Photographs are not retained or used for model training without separate consent.'

function normalizedMeasurements(measurements, modelVersions) {
  return Object.fromEntries(Object.entries(measurements).map(([code, item]) => [code, { ...item, confidence: item.quality_score, warnings: item.reason_codes, model_versions: modelVersions }]))
}

export function ServerCameraScanPage() {
  const navigate = useNavigate(); const { flow, updateFlow } = useFlow(); const camera = useCameraStream()
  const videoRef = useRef(null); const abortRef = useRef(null)
  const [height, setHeight] = useState(''); const [serverConsent, setServerConsent] = useState(false); const [session, setSession] = useState(null)
  const [view, setView] = useState('FRONT'); const [frontTokens, setFrontTokens] = useState([]); const [sideTokens, setSideTokens] = useState([])
  const [phase, setPhase] = useState('consent'); const [progress, setProgress] = useState('Preparing image'); const [prepared, setPrepared] = useState(null); const [error, setError] = useState(null); const [result, setResult] = useState(null)

  useEffect(() => { if (videoRef.current && camera.stream) { videoRef.current.srcObject = camera.stream; videoRef.current.play?.().catch(() => {}) } }, [camera.stream])
  useEffect(() => () => { abortRef.current?.abort(); camera.stop() }, [camera.stop])

  const start = async () => {
    const heightMm = Math.round(Number(height) * 10); setError(null)
    if (!flow.participant || !flow.consented) return setError('Complete the service consent step before camera processing.')
    if (!serverConsent) return setError('Explicit consent is required before a processing session can begin.')
    if (!Number.isInteger(heightMm) || heightMm < 1000 || heightMm > 2500) return setError('Enter a verified height from 100 to 250 cm.')
    try {
      setPhase('starting'); await api.cameraProcessingConsent(flow.participant.id, flow.participant.participant_access_token); const created = await api.cameraProcessingSession(flow.participant.id, flow.participant.participant_access_token)
      setSession({ ...created, heightMm }); await camera.start(''); setPhase('ready')
    } catch (caught) { camera.stop(); setError(caught.message); setPhase('consent') }
  }

  const capture = async () => {
    const video = videoRef.current
    if (!video?.videoWidth || !video?.videoHeight || !session) return setError('Wait until the live camera preview is ready.')
    const candidateIndex = view === 'FRONT' ? frontTokens.length : sideTokens.length
    abortRef.current = new AbortController(); setError(null); setPrepared(null); setPhase('processing')
    try {
      const response = await analyzeServerImage({ source: video, sessionToken: session.session_token, view, heightMm: session.heightMm, candidateIndex, captureMetadata: camera.capabilitySnapshot || {}, signal: abortRef.current.signal, onProgress: setProgress, onPrepared: setPrepared })
      if (view === 'FRONT') { setFrontTokens((items) => [...items, response.observation_token]); setView('SIDE') }
      else setSideTokens((items) => [...items, response.observation_token])
      setPhase('ready')
    } catch (caught) {
      setError(caught.result?.highest_priority_correction || caught.message)
      if (caught.status === 401) { setFrontTokens([]); setSideTokens([]); setSession(null); camera.stop(); setPhase('consent') }
      else setPhase('ready')
    }
    finally { abortRef.current = null }
  }

  const finalize = async () => {
    abortRef.current = new AbortController(); setError(null); setPhase('finalizing'); setProgress('Calculating measurements')
    try {
      const completed = await finalizeServerObservations({ sessionToken: session.session_token, frontTokens, sideTokens, signal: abortRef.current.signal })
      setResult({ ...completed, measurements: normalizedMeasurements(completed.measurements, completed.model_versions) }); setFrontTokens([]); setSideTokens([]); setSession(null); camera.stop(); setProgress('Ready for review'); setPhase('results')
    } catch (caught) {
      setError(caught.message)
      if (caught.status === 401) { setFrontTokens([]); setSideTokens([]); setSession(null); camera.stop(); setPhase('consent') }
      else setPhase('ready')
    }
    finally { abortRef.current = null }
  }

  const finish = () => {
    updateFlow({ measurements: mergeMeasurementPrefill(flow.measurements, result.measurements, flow.unit), cameraScan: { status: 'server_review', pipelineVersion: result.pipeline_version, measurements: result.measurements, overallConfidence: result.overall_quality_score, warnings: result.reason_codes, calibrationMode: result.calibration_method, captures: {} } })
    setResult(null); navigate('/measurements')
  }
  const cancel = () => { abortRef.current?.abort(); camera.stop(); setFrontTokens([]); setSideTokens([]); setSession(null); setResult(null); navigate('/measurements') }
  const matched = frontTokens.length > 0 && frontTokens.length === sideTokens.length
  const canAddPair = matched && frontTokens.length < 3

  return <section className="page page-camera-scan">
    <PageHeader eyebrow="Server camera scan · Experimental" title="Capture one front and one profile photograph." description="Each compressed photograph is processed in a separate short-lived AWS Lambda request. Measurement quality has not been commercially validated." />
    <Notice tone="warning">Close-fitting clothing is required. Loose clothing, perspective, camera tilt, lens distortion, and silhouette errors cannot be reliably reversed from ordinary RGB photographs.</Notice>
    <div className="photo-privacy"><ShieldCheck size={22} aria-hidden="true" /><p>{privacyCopy}</p></div>
    {phase === 'consent' && <div className="scan-card"><h2>Start a private processing session</h2><label className="field compact-field">Verified height in centimetres<input type="number" min="100" max="250" step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} /></label><label className="consent-check"><input type="checkbox" checked={serverConsent} onChange={(event) => setServerConsent(event.target.checked)} /><span>I explicitly consent to transmitting one compressed photograph at a time for volatile server processing. I understand failed requests require resubmission because photographs are not stored.</span></label><button type="button" className="primary-button" onClick={start} disabled={!serverConsent}><Camera size={17} aria-hidden="true" /> Start camera</button></div>}
    {phase === 'starting' && <div className="loading-state" role="status">Requesting a five-minute processing session and camera permission…</div>}
    {['ready', 'processing', 'finalizing'].includes(phase) && <><div className="server-camera-viewport"><video ref={videoRef} playsInline muted autoPlay aria-label={`${view.toLowerCase()} camera preview`} /><div className="body-guide" aria-hidden="true" /></div><p aria-live="polite">{view === 'FRONT' ? 'Face the camera directly with your full head and feet visible.' : 'Turn to a true left or right profile with your full head and feet visible.'}</p>{prepared && <p>Prepared upload: {(prepared.byteSize / 1024).toFixed(0)} KB · {prepared.width} × {prepared.height}px</p>}{phase === 'processing' || phase === 'finalizing' ? <div className="loading-state" role="status">{progress}…</div> : <button type="button" className="primary-button" onClick={capture}>Capture {view === 'FRONT' ? 'front' : 'side'} photo</button>}<p>{frontTokens.length} front and {sideTokens.length} side observations accepted. Tokens remain only in this page’s memory.</p>{matched && phase === 'ready' && <div className="inline-actions"><button type="button" className="primary-button" onClick={finalize}>Calculate measurements</button>{canAddPair && <button type="button" className="secondary-button" onClick={() => setView('FRONT')}>Add another matched pair</button>}</div>}</>}
    {phase === 'results' && result && <div className="scan-card"><h2>Ready for manual review</h2><ServerMeasurementReview result={result} /><button type="button" className="primary-button" onClick={finish}>Use reviewed numeric estimates</button></div>}
    {error && <Notice tone="error"><span role="alert">{error}</span></Notice>}
    <div className="page-actions"><button type="button" className="secondary-button" onClick={cancel}><ArrowLeft size={17} aria-hidden="true" /> Cancel and return to manual measurements</button><button type="button" className="secondary-button" onClick={() => { cancel(); navigate('/measurements/photos') }}>Use existing photos</button></div>
  </section>
}
