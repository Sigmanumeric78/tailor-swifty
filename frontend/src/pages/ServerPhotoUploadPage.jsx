import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ImagePlus, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { useFlow } from '../features/FlowContext'
import { mergeMeasurementPrefill } from '../features/cameraScan/prefill'
import { ServerMeasurementReview } from '../features/cameraScan/components/ServerMeasurementReview'
import { analyzeServerImage, finalizeServerObservations } from '../features/cameraScan/services/serverCameraClient'

const privacyCopy = 'Front and side photographs are transmitted securely to an AWS processing function, held only in volatile processing memory, and discarded when each request completes. Tailor Swifty stores only reviewed numeric measurements and processing provenance. Photographs are not retained or used for model training without separate consent.'
const normalize = (measurements, modelVersions) => Object.fromEntries(Object.entries(measurements).map(([code, item]) => [code, { ...item, confidence: item.quality_score, warnings: item.reason_codes, model_versions: modelVersions }]))

export function ServerPhotoUploadPage() {
  const navigate = useNavigate(); const { flow, updateFlow } = useFlow(); const abortRef = useRef(null)
  const [height, setHeight] = useState(''); const [consent, setConsent] = useState(false); const [session, setSession] = useState(null)
  const [frontTokens, setFrontTokens] = useState([]); const [sideTokens, setSideTokens] = useState([]); const [phase, setPhase] = useState('consent'); const [progress, setProgress] = useState('Preparing image'); const [prepared, setPrepared] = useState(null); const [error, setError] = useState(null); const [result, setResult] = useState(null)
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const start = async () => {
    const heightMm = Math.round(Number(height) * 10); setError(null)
    if (!flow.participant || !flow.consented) return setError('Complete the service consent step before photo processing.')
    if (!consent) return setError('Explicit server image-processing consent is required.')
    if (!Number.isInteger(heightMm) || heightMm < 1000 || heightMm > 2500) return setError('Enter a verified height from 100 to 250 cm.')
    try { setPhase('starting'); await api.cameraProcessingConsent(flow.participant.id, flow.participant.participant_access_token); const created = await api.cameraProcessingSession(flow.participant.id, flow.participant.participant_access_token); setSession({ ...created, heightMm }); setPhase('selecting') }
    catch (caught) { setError(caught.message); setPhase('consent') }
  }

  const select = async (view, event) => {
    const input = event.currentTarget; const file = input.files?.[0]; input.value = ''
    if (!file || !session) return
    const tokens = view === 'FRONT' ? frontTokens : sideTokens
    if (tokens.length >= 3) return setError(`No more than three ${view.toLowerCase()} candidates are allowed.`)
    abortRef.current = new AbortController(); setPrepared(null); setError(null); setPhase('processing')
    try {
      const response = await analyzeServerImage({ source: file, sessionToken: session.session_token, view, heightMm: session.heightMm, candidateIndex: tokens.length, signal: abortRef.current.signal, onProgress: setProgress, onPrepared: setPrepared })
      if (view === 'FRONT') setFrontTokens((items) => [...items, response.observation_token]); else setSideTokens((items) => [...items, response.observation_token])
      setPhase('selecting')
    } catch (caught) {
      setError(`${view}: ${caught.result?.highest_priority_correction || caught.message}`)
      if (caught.status === 401) { setFrontTokens([]); setSideTokens([]); setSession(null); setPhase('consent') }
      else setPhase('selecting')
    }
    finally { abortRef.current = null }
  }

  const finalize = async () => {
    abortRef.current = new AbortController(); setPhase('processing'); setProgress('Calculating measurements'); setError(null)
    try { const completed = await finalizeServerObservations({ sessionToken: session.session_token, frontTokens, sideTokens, signal: abortRef.current.signal }); setResult({ ...completed, measurements: normalize(completed.measurements, completed.model_versions) }); setFrontTokens([]); setSideTokens([]); setSession(null); setPhase('results') }
    catch (caught) {
      setError(caught.message)
      if (caught.status === 401) { setFrontTokens([]); setSideTokens([]); setSession(null); setPhase('consent') }
      else setPhase('selecting')
    }
    finally { abortRef.current = null }
  }
  const cancel = () => { abortRef.current?.abort(); setFrontTokens([]); setSideTokens([]); setSession(null); setResult(null); navigate('/measurements') }
  const finish = () => { updateFlow({ measurements: mergeMeasurementPrefill(flow.measurements, result.measurements, flow.unit), cameraScan: { status: 'server_photo_review', pipelineVersion: result.pipeline_version, measurements: result.measurements, overallConfidence: result.overall_quality_score, warnings: result.reason_codes, calibrationMode: result.calibration_method, captures: {} } }); setResult(null); navigate('/measurements') }
  const matched = frontTokens.length > 0 && frontTokens.length === sideTokens.length

  return <section className="page page-photo-upload">
    <PageHeader eyebrow="Server photo scan · Experimental" title="Process matched front and profile photographs." description="Each selected file is oriented, resized, stripped of EXIF, compressed, sent alone, and released before another photograph is selected." />
    <Notice tone="warning">Use one to three independent matched pairs. Full head and feet must be visible; diagonal views are unsupported; close-fitting clothing is required.</Notice>
    <div className="photo-privacy"><ShieldCheck size={22} aria-hidden="true" /><p>{privacyCopy}</p></div>
    {phase === 'consent' && <div className="scan-card"><label className="field compact-field">Verified height in centimetres<input type="number" min="100" max="250" step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} /></label><label className="consent-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I explicitly consent to one-at-a-time HTTPS transmission for volatile AWS Lambda processing. Failed requests require selecting the photograph again because it is not retained.</span></label><button type="button" className="primary-button" disabled={!consent} onClick={start}>Create private processing session</button></div>}
    {phase === 'starting' && <div className="loading-state" role="status">Creating a five-minute processing session…</div>}
    {['selecting', 'processing'].includes(phase) && <div className="photo-selectors"><section className="scan-card"><h2>Front candidates</h2><p>{frontTokens.length}/3 accepted.</p><label className="secondary-button file-button"><ImagePlus size={17} aria-hidden="true" /> Select one front JPEG or WebP<input type="file" accept="image/jpeg,image/webp" aria-label="Select one front JPEG or WebP" onChange={(event) => select('FRONT', event)} disabled={phase === 'processing' || frontTokens.length >= 3} /></label></section><section className="scan-card"><h2>Profile candidates</h2><p>{sideTokens.length}/3 accepted.</p><label className="secondary-button file-button"><ImagePlus size={17} aria-hidden="true" /> Select one profile JPEG or WebP<input type="file" accept="image/jpeg,image/webp" aria-label="Select one profile JPEG or WebP" onChange={(event) => select('SIDE', event)} disabled={phase === 'processing' || sideTokens.length >= 3} /></label></section></div>}
    {prepared && <p>Prepared upload: {(prepared.byteSize / 1024).toFixed(0)} KB · {prepared.width} × {prepared.height}px</p>}
    {phase === 'processing' && <div className="loading-state" role="status">{progress}…</div>}
    {matched && phase === 'selecting' && <button type="button" className="primary-button" onClick={finalize}>Calculate measurements from {frontTokens.length} matched pair{frontTokens.length === 1 ? '' : 's'}</button>}
    {phase === 'results' && result && <div className="scan-card"><h2>Ready for manual review</h2><ServerMeasurementReview result={result} /><button type="button" className="primary-button" onClick={finish}>Use reviewed numeric estimates</button></div>}
    {error && <Notice tone="error"><span role="alert">{error}</span></Notice>}
    <div className="page-actions"><button type="button" className="secondary-button" onClick={cancel}><ArrowLeft size={17} aria-hidden="true" /> Cancel and forget this session</button></div>
  </section>
}
