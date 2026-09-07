import { useCallback, useEffect, useRef, useState } from 'react'
import { useMachine } from '@xstate/react'
import { ArrowLeft, Camera, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Notice } from '../components/Notice'
import { PageHeader } from '../components/PageHeader'
import { cameraMachine } from '../features/cameraScan/cameraMachine'
import { CaptureInstructions } from '../features/cameraScan/components/CaptureInstructions'
import { CameraViewport } from '../features/cameraScan/components/CameraViewport'
import { MeasurementEstimateReview } from '../features/cameraScan/components/MeasurementEstimateReview'
import { ScanReview } from '../features/cameraScan/components/ScanReview'
import { selectTemporallySeparatedFrames } from '../features/cameraScan/geometry/statistics'
import { captureBurst, releaseFrames, useCameraStream } from '../features/cameraScan/hooks/useCameraStream'
import { PIPELINE_VERSION, scanConfig } from '../features/cameraScan/scanConfig'
import { CameraModelRegistry } from '../features/cameraScan/services/modelRegistry'
import { processCaptureRepetitions } from '../features/cameraScan/services/measurementPipeline'
import { scoreCapturedFrame } from '../features/cameraScan/services/opencvQualityService'
import { useFlow } from '../features/FlowContext'

export function mergeCameraPrefill(existing, estimates) {
  const eligible = Object.fromEntries(Object.entries(estimates).filter(([, item]) => item.value_mm != null && item.confidence >= scanConfig.confidence.mediumMin && !existing[item.measurement_code]).map(([code, item]) => [code, (item.value_mm / 10).toFixed(2)]))
  return { ...eligible, ...existing }
}

export function CameraScanPage() {
  const navigate = useNavigate(); const { flow, updateFlow } = useFlow(); const [state, send] = useMachine(cameraMachine)
  const registryRef = useRef(null); const webcamRef = useRef(null); const framesRef = useRef([]); const camera = useCameraStream(); const [height, setHeight] = useState(''); const [deviceId, setDeviceId] = useState('')
  const stopCamera = camera.stop
  const view = state.context.activeView || 'front'
  const cleanup = useCallback(() => {
    stopCamera(); registryRef.current?.dispose(); registryRef.current = null
    releaseFrames(framesRef.current); framesRef.current = []
    const video = webcamRef.current?.video; if (video) video.srcObject = null
  }, [stopCamera])
  framesRef.current = [...state.context.frontFrames, ...state.context.sideFrames]
  const returnManual = useCallback(() => { send({ type: 'RETURN_TO_MANUAL', cleanup }); navigate('/measurements') }, [cleanup, navigate, send])

  useEffect(() => {
    if (!state.matches('loadingModels') || registryRef.current) return
    const registry = new CameraModelRegistry(); registryRef.current = registry
    registry.initialize().then(() => send({ type: 'MODELS_READY' })).catch((error) => send({ type: 'MODEL_ERROR', error: error.message }))
  }, [send, state])
  useEffect(() => {
    if (!state.matches(`${view}.countdown`)) return undefined
    const timer = window.setTimeout(() => send({ type: 'COUNTDOWN_COMPLETE' }), 3000)
    return () => window.clearTimeout(timer)
  }, [send, state, view])
  useEffect(() => {
    if (!state.matches(`${view}.capturingBurst`)) return
    let cancelled = false
    captureBurst(webcamRef.current.video).then(async (frames) => {
      if (cancelled) return releaseFrames(frames)
      const scoredFrames = frames.map((frame) => scoreCapturedFrame(registryRef.current.cv, frame))
      const selectedFrames = selectTemporallySeparatedFrames(scoredFrames, scanConfig.capture.selectedFrames, scanConfig.capture.minimumSeparationMs)
      const selectedIds = new Set(selectedFrames.map((frame) => frame.id)); releaseFrames(frames.filter((frame) => !selectedIds.has(frame.id)))
      send({ type: 'BURST_COMPLETE', frames: selectedFrames, selectedFrames })
    }).catch((error) => send({ type: 'PROCESS_ERROR', error: error.message }))
    return () => { cancelled = true }
  }, [send, state, view])
  useEffect(() => {
    if (!state.matches('processing')) return
    processCaptureRepetitions(registryRef.current, state.context.selectedFrontFrames, state.context.selectedSideFrames, state.context.heightMm)
      .then((result) => send({ type: result.overallConfidence < scanConfig.confidence.mediumMin ? 'PROCESS_LOW_CONFIDENCE' : 'PROCESS_SUCCESS', ...result }))
      .catch((error) => send({ type: 'PROCESS_ERROR', error: error.message }))
  }, [send, state])
  useEffect(() => cleanup, [cleanup])

  const finish = () => {
    const cameraMeasurements = state.context.measurements
    updateFlow({ measurements: mergeCameraPrefill(flow.measurements, cameraMeasurements), unit: 'cm', cameraScan: { status: 'review', pipelineVersion: PIPELINE_VERSION, heightMm: state.context.heightMm, captures: { front: state.context.selectedFrontFrames.length, side: state.context.selectedSideFrames.length }, measurements: cameraMeasurements, overallConfidence: state.context.overallConfidence, warnings: state.context.warnings } })
    cleanup(); navigate('/measurements')
  }
  const retryModels = () => { registryRef.current?.dispose(); registryRef.current = null; send({ type: 'START' }) }
  const retake = (targetView) => { releaseFrames(targetView === 'front' ? state.context.frontFrames : state.context.sideFrames); send({ type: 'RETAKE_VIEW', view: targetView }) }
  const live = state.matches(`${view}.aligning`) || state.matches(`${view}.countdown`) || state.matches(`${view}.capturingBurst`)
  return <section className="page page-camera-scan">
    <PageHeader eyebrow="On-device camera scan · Experimental" title="Estimate shirt measurements from two views." description="Camera measurements are experimental estimates. Images stay in browser memory and are never uploaded or saved." />
    <Notice tone="warning">Close-fitting clothing is required. Loose clothes conceal the underlying body and cannot be accurately reversed from ordinary RGB photographs. Low-confidence measurements require retry or manual measurement.</Notice>
    {state.matches('idle') && <div className="scan-card"><ShieldCheck size={28} aria-hidden="true" /><h2>Privacy-first scan</h2><p>The camera permission prompt appears only after you start. Processing uses pinned, same-origin models on this device.</p><button className="primary-button" type="button" onClick={() => send({ type: 'START' })}><Camera size={17} aria-hidden="true" /> Start camera scan</button></div>}
    {state.matches('requestingPermission') && <CameraViewport webcamRef={webcamRef} view="front" onGranted={(stream) => { camera.adopt(stream); send({ type: 'CAMERA_GRANTED' }) }} onDenied={() => send({ type: 'CAMERA_DENIED' })} onQuality={() => {}} onStable={() => {}} />}
    {state.matches('permissionDenied') && <><Notice tone="error">Camera permission was denied or unavailable. Allow camera access in your browser’s site settings, then retry, or return to manual measurement.</Notice><button className="secondary-button" type="button" onClick={() => send({ type: 'START' })}>Retry camera permission</button></>}
    {state.matches('loadingModels') && <div className="loading-state" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Loading integrity-locked models on this device…</div>}
    {state.matches('modelLoadFailed') && <><Notice tone="error">Models could not load: {state.context.error}. Check the same-origin model assets, retry, or use manual entry.</Notice><button className="secondary-button" type="button" onClick={retryModels}>Retry model loading</button></>}
    {state.matches('heightEntry') && <form className="scan-card" onSubmit={(event) => { event.preventDefault(); send({ type: 'SET_HEIGHT_MM', heightMm: Math.round(Number(height) * 10) }) }}><h2>Enter verified height</h2><p>Measure without shoes. Height calibrates front and side independently.</p><label className="field compact-field">Height in centimetres<input aria-label="Height in centimetres" type="number" min="100" max="250" step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} required /></label><button className="primary-button" type="submit">Continue</button></form>}
    {(state.matches(`${view}.instructions`)) && <><CaptureInstructions view={view} /><button className="primary-button" type="button" onClick={() => send({ type: 'START' })}>Align {view} view</button></>}
    {live && <>{camera.devices.length > 1 && <label className="field compact-field">Camera<select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">Automatic camera</option>{camera.devices.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>}<CameraViewport key={deviceId || 'automatic'} deviceId={deviceId} webcamRef={webcamRef} registry={registryRef.current} view={view} onGranted={camera.adopt} onDenied={() => send({ type: 'CAMERA_DENIED' })} onQuality={(quality) => send({ type: 'QUALITY_UPDATE', metrics: quality, reasonCodes: quality.reasonCodes })} onStable={() => send({ type: 'POSE_STABLE' })} />{state.matches(`${view}.countdown`) && <p className="countdown" aria-live="assertive">Hold still · capturing in 3 seconds</p>}{state.matches(`${view}.capturingBurst`) && <p className="countdown" aria-live="assertive">Capturing eight frames…</p>}</>}
    {state.matches('front.review') && <ScanReview view="front" selectedCount={state.context.selectedFrontFrames.length} onRetake={() => retake('front')} onAccept={() => send({ type: 'ACCEPT_CAPTURE' })} />}
    {state.matches('side.review') && <ScanReview view="side" selectedCount={state.context.selectedSideFrames.length} onRetake={() => retake('side')} onAccept={() => send({ type: 'ACCEPT_CAPTURE' })} />}
    {state.matches('processing') && <div className="loading-state" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Comparing silhouettes and calculating repeated estimates…</div>}
    {state.matches('lowConfidence') && <><Notice tone="warning">The repeated estimates did not agree well enough. One additional burst is allowed per view; after that, complete the affected values manually.</Notice><div className="inline-actions"><button className="secondary-button" disabled={state.context.captureAttempts.front >= 2} onClick={() => retake('front')}>Retake front</button><button className="secondary-button" disabled={state.context.captureAttempts.side >= 2} onClick={() => retake('side')}>Retake side</button></div></>}
    {state.matches('results') && <><MeasurementEstimateReview measurements={state.context.measurements} /><Notice>Shirt length is not directly observable because it depends on your preferred hem position. Enter and review it manually.</Notice><button className="primary-button" type="button" onClick={finish}>Review estimates in manual form</button></>}
    {state.matches('fatalError') && <Notice tone="error">Processing stopped safely: {state.context.error}. No failed measurement was converted to zero.</Notice>}
    <div className="page-actions"><button type="button" className="secondary-button" onClick={returnManual}><ArrowLeft size={17} aria-hidden="true" /> Return to manual measurements</button></div>
  </section>
}
