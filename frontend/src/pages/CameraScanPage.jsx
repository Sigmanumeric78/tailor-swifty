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
import { cameraDisplayName, captureBurst, releaseFrames, useCameraStream } from '../features/cameraScan/hooks/useCameraStream'
import { PIPELINE_VERSION, scanConfig } from '../features/cameraScan/scanConfig'
import { mergeMeasurementPrefill } from '../features/cameraScan/prefill'
import { CameraModelRegistry } from '../features/cameraScan/services/modelRegistry'
import { FrameValidationError, processCaptureRepetitions, validateCapturedFrame } from '../features/cameraScan/services/measurementPipeline'
import { DeviceOrientationAdapter } from '../features/cameraScan/services/deviceOrientationService'
import { useFlow } from '../features/FlowContext'

export const mergeCameraPrefill = mergeMeasurementPrefill

function CountdownStatus({ deadline }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - performance.now()))
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, deadline - performance.now())); update(); const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [deadline])
  return <p className="countdown" aria-live="assertive">Hold the pose · capturing in {Math.max(1, Math.ceil(remaining / 1000))} second{Math.ceil(remaining / 1000) === 1 ? '' : 's'}</p>
}

export function CameraScanPage() {
  const navigate = useNavigate(); const { flow, updateFlow } = useFlow(); const [state, send] = useMachine(cameraMachine)
  const registryRef = useRef(null); const webcamRef = useRef(null); const framesRef = useRef([]); const orientationRef = useRef(null); const camera = useCameraStream(); const [height, setHeight] = useState(''); const [deviceId, setDeviceId] = useState(''); const [videoReady, setVideoReady] = useState(false); const [clothingFitConfirmed, setClothingFitConfirmed] = useState(false); const [orientation, setOrientation] = useState({ status: 'idle', snapshot: null })
  const stopCamera = camera.stop
  const view = state.context.activeView || 'front'
  const loadingModels = state.matches('loadingModels')
  const capturingView = state.matches('front.capturingBurst') ? 'front' : state.matches('side.capturingBurst') ? 'side' : null
  const processing = state.matches('processing')
  useEffect(() => setVideoReady(false), [deviceId, view])
  const cleanup = useCallback(() => {
    stopCamera(); orientationRef.current?.dispose(); orientationRef.current = null; registryRef.current?.dispose(); registryRef.current = null
    releaseFrames(framesRef.current); framesRef.current = []
    const video = webcamRef.current?.video; if (video) video.srcObject = null
  }, [stopCamera])
  framesRef.current = [...state.context.frontFrames, ...state.context.sideFrames]
  const returnManual = useCallback(() => { send({ type: 'RETURN_TO_MANUAL', cleanup }); navigate('/measurements') }, [cleanup, navigate, send])

  useEffect(() => {
    if (!loadingModels || registryRef.current) return
    const registry = new CameraModelRegistry(); registryRef.current = registry
    registry.initializeLive().then(() => send({ type: 'MODELS_READY' })).catch((error) => send({ type: 'MODEL_ERROR', error: error.message }))
  }, [loadingModels, send])
  useEffect(() => {
    if (state.matches('modelLoadFailed') || state.matches('fatalError') || state.matches('cancelled')) camera.stop()
  }, [camera.stop, state])
  useEffect(() => {
    if (!capturingView) return
    let cancelled = false; let capturedFrames = []
    ;(async () => {
      const captureStarted = performance.now()
      try {
        capturedFrames = await captureBurst(webcamRef.current.video)
        registryRef.current.recordRetainedImages(capturedFrames.length)
        if (cancelled) return releaseFrames(capturedFrames)
        await registryRef.current.initializeQuality()
        const validatedCandidates = []; let dominantError = null
        for (const frame of capturedFrames) {
          try { validatedCandidates.push(await validateCapturedFrame(registryRef.current, frame, capturingView)) }
          catch (error) { dominantError ||= error; releaseFrames([frame]) }
        }
        const selectedFrames = selectTemporallySeparatedFrames(validatedCandidates, scanConfig.capture.selectedFrames, scanConfig.capture.minimumSeparationMs)
        if (selectedFrames.length < scanConfig.capture.selectedFrames) throw new FrameValidationError({ id: `${capturingView} burst` }, capturingView, ['IMAGE_BLURRED'])
        if (cancelled) return releaseFrames(capturedFrames)
        const selectedIds = new Set(selectedFrames.map((frame) => frame.id)); releaseFrames(validatedCandidates.filter((frame) => !selectedIds.has(frame.id)))
        if (dominantError) selectedFrames.forEach((frame) => { frame.postCaptureWarnings = [...new Set([...(frame.postCaptureWarnings || []), 'CAPTURE_CANDIDATE_REJECTED'])] })
        const warningCodes = [...new Set(selectedFrames.flatMap((frame) => frame.postCaptureWarnings || []))]
        send({ type: 'BURST_COMPLETE', frames: selectedFrames, selectedFrames, warningCodes, dominantError: dominantError?.reasonCodes?.[0] })
        registryRef.current?.recordInference('captureProcessing', performance.now() - captureStarted)
      } catch (error) {
        releaseFrames(capturedFrames)
        if (cancelled) return
        if (error instanceof FrameValidationError) send({ type: 'BURST_REJECTED', error: error.message, warningCodes: error.reasonCodes })
        else { cleanup(); send({ type: 'PROCESS_ERROR', error: error.message }) }
      }
    })()
    return () => { cancelled = true }
  }, [capturingView, cleanup, send])
  useEffect(() => {
    if (!processing) return
    registryRef.current.initializeSegmentation()
      .then(() => processCaptureRepetitions(registryRef.current, state.context.selectedFrontFrames, state.context.selectedSideFrames, state.context.heightMm, { minimumValid: 3, source: 'camera_estimate', cameraMetadataAvailable: Boolean(camera.capabilitySnapshot?.width), clothingFitConfirmed }))
      .then((result) => send({ type: result.overallConfidence < scanConfig.confidence.mediumMin ? 'PROCESS_LOW_CONFIDENCE' : 'PROCESS_SUCCESS', ...result }))
      .catch((error) => { cleanup(); send({ type: 'PROCESS_ERROR', error: error.message }) })
  }, [camera.capabilitySnapshot?.width, cleanup, clothingFitConfirmed, processing, send, state.context.heightMm, state.context.selectedFrontFrames, state.context.selectedSideFrames])
  useEffect(() => cleanup, [cleanup])

  const finish = () => {
    const cameraMeasurements = state.context.measurements
    updateFlow({ measurements: mergeMeasurementPrefill(flow.measurements, cameraMeasurements, flow.unit), cameraScan: { status: 'review', pipelineVersion: PIPELINE_VERSION, heightMm: state.context.heightMm, captures: { front: state.context.selectedFrontFrames.length, side: state.context.selectedSideFrames.length }, measurements: cameraMeasurements, overallConfidence: state.context.overallConfidence, warnings: state.context.warnings, calibrationMode: 'VERIFIED_HEIGHT', capabilitySummary: camera.capabilitySnapshot } })
    cleanup(); navigate('/measurements')
  }
  const retryModels = () => { registryRef.current?.dispose(); registryRef.current = null; send({ type: 'START' }) }
  const retake = (targetView) => { camera.stop(); releaseFrames(targetView === 'front' ? state.context.frontFrames : state.context.sideFrames); send({ type: 'RETAKE_VIEW', view: targetView }) }
  const requestOrientation = async () => { const adapter = orientationRef.current || new DeviceOrientationAdapter(); orientationRef.current = adapter; setOrientation(await adapter.start((snapshot) => setOrientation({ status: 'active', snapshot }))) }
  const live = state.matches(`${view}.aligning`) || state.matches(`${view}.ready`) || state.matches(`${view}.countdown`) || state.matches(`${view}.capturingBurst`)
  return <section className="page page-camera-scan">
    <PageHeader eyebrow="On-device camera scan · Experimental" title="Estimate shirt measurements from two views." description="Camera measurements are experimental estimates. Images stay in browser memory and are never uploaded or saved." />
    <Notice tone="warning">Close-fitting clothing is required. Loose clothes conceal the underlying body and cannot be accurately reversed from ordinary RGB photographs. Low-confidence measurements require retry or manual measurement.</Notice>
    {state.matches('idle') && <div className="scan-card"><ShieldCheck size={28} aria-hidden="true" /><h2>Privacy-first scan</h2><p>The camera permission prompt appears only after you start. Processing uses pinned, same-origin models on this device.</p><button className="primary-button" type="button" onClick={() => send({ type: 'START' })}><Camera size={17} aria-hidden="true" /> Start camera scan</button></div>}
    {state.matches('requestingPermission') && <CameraViewport webcamRef={webcamRef} view="front" onGranted={(stream) => { camera.adopt(stream); send({ type: 'CAMERA_GRANTED' }) }} onDenied={() => send({ type: 'CAMERA_DENIED' })} onQuality={() => {}} onStable={() => {}} />}
    {state.matches('permissionDenied') && <><Notice tone="error">Camera permission was denied or unavailable. Allow camera access in your browser’s site settings, then retry, or return to manual measurement.</Notice><button className="secondary-button" type="button" onClick={() => send({ type: 'START' })}>Retry camera permission</button></>}
    {state.matches('loadingModels') && <div className="loading-state" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Loading integrity-locked models on this device…</div>}
    {state.matches('modelLoadFailed') && <><Notice tone="error">Models could not load: {state.context.error}. Check the same-origin model assets, retry, or use manual entry.</Notice><button className="secondary-button" type="button" onClick={retryModels}>Retry model loading</button></>}
    {state.matches('heightEntry') && <form className="scan-card" onSubmit={(event) => { event.preventDefault(); send({ type: 'SET_HEIGHT_MM', heightMm: Math.round(Number(height) * 10) }) }}><h2>Enter verified height</h2><p>Measure without shoes. Height calibrates front and side independently using a weak-perspective estimate.</p><label className="field compact-field">Height in centimetres<input aria-label="Height in centimetres" type="number" min="100" max="250" step="0.1" value={height} onChange={(event) => setHeight(event.target.value)} required /></label><label className="checkbox-row"><input type="checkbox" checked={clothingFitConfirmed} onChange={(event) => setClothingFitConfirmed(event.target.checked)} required /> I confirm I am wearing close-fitting clothing.</label><p><strong>Calibration:</strong> verified height is available. Printed-reference and native depth calibration are not available in this web build.</p><button className="primary-button" type="submit">Continue</button></form>}
    {(state.matches(`${view}.instructions`)) && <><CaptureInstructions view={view} /><button className="primary-button" type="button" onClick={() => send({ type: 'START' })}>Align {view} view</button></>}
    {live && <><fieldset className="segmented capture-mode"><legend>Capture mode</legend><button type="button" aria-pressed={state.context.captureMode === 'manual'} onClick={() => send({ type: 'SET_CAPTURE_MODE', mode: 'manual' })}>Manual</button><button type="button" aria-pressed={state.context.captureMode === 'auto'} onClick={() => send({ type: 'SET_CAPTURE_MODE', mode: 'auto' })}>Auto</button></fieldset>{camera.devices.length > 1 && <label className="field compact-field">Front or rear camera<select value={deviceId} onChange={(event) => { camera.stop(); camera.clearCameraChangeWarning(); setDeviceId(event.target.value) }}><option value="">Automatic rear camera preference</option>{camera.devices.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{cameraDisplayName(device, index)}</option>)}</select></label>}<button type="button" className="secondary-button" onClick={requestOrientation}>Enable optional phone-level guidance</button>{orientation.status === 'denied' && <p>Orientation permission was denied. Camera capture remains available.</p>}{orientation.snapshot && <p aria-live="polite">Phone level guide: roll {Math.round(orientation.snapshot.roll || 0)}°, pitch {Math.round(orientation.snapshot.pitch || 0)}°.</p>}{camera.cameraChangeWarning && <Notice tone="warning">{camera.cameraChangeWarning}</Notice>}<CameraViewport key={deviceId || 'automatic'} deviceId={deviceId} webcamRef={webcamRef} registry={registryRef.current} view={view} onGranted={camera.adopt} onDenied={() => { camera.stop(); send({ type: 'CAMERA_DENIED' }) }} onVideoReady={setVideoReady} onQuality={(quality) => send({ type: 'QUALITY_UPDATE', metrics: quality, hardReasonCodes: quality.hardReasonCodes, warningCodes: quality.warningCodes, timestamp: quality.timestamp })} onStable={() => { if (state.matches(`${view}.aligning`)) send({ type: 'POSE_STABLE' }) }} />{state.context.captureError && <Notice tone="error">{state.context.captureError}</Notice>}<button type="button" className="primary-button manual-capture-button" disabled={!videoReady || !registryRef.current?.liveReady || !state.context.qualityMetrics || state.context.qualityHardReasons.length > 0 || state.matches(`${view}.capturingBurst`)} onClick={() => send({ type: 'CAPTURE_NOW' })}>{state.matches(`${view}.capturingBurst`) ? `Capturing ${view}…` : `Capture ${view} now`}</button>{state.context.captureMode === 'auto' && state.matches(`${view}.aligning`) && <p aria-live="polite">Auto readiness: {Math.round(state.context.qualityReadiness.passRatio * 100)}% of {state.context.qualityReadiness.sampleCount} recent checks.</p>}{state.matches(`${view}.countdown`) && <CountdownStatus deadline={state.context.countdownDeadline} />}{state.matches(`${view}.capturingBurst`) && <p className="countdown" aria-live="assertive">Capturing and validating eight frames locally…</p>}</>}
    {state.matches('front.review') && <ScanReview view="front" frame={state.context.selectedFrontFrames[0]} selectedCount={state.context.selectedFrontFrames.length} warningCodes={state.context.captureWarnings} onRetake={() => retake('front')} onAccept={() => send({ type: 'ACCEPT_CAPTURE' })} />}
    {state.matches('side.review') && <ScanReview view="side" frame={state.context.selectedSideFrames[0]} selectedCount={state.context.selectedSideFrames.length} warningCodes={state.context.captureWarnings} onRetake={() => retake('side')} onAccept={() => send({ type: 'ACCEPT_CAPTURE' })} />}
    {state.matches('processing') && <div className="loading-state" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Comparing silhouettes and calculating repeated estimates…</div>}
    {state.matches('lowConfidence') && <><Notice tone="warning">The repeated estimates did not agree well enough. One additional burst is allowed per view; after that, complete the affected values manually.</Notice><div className="inline-actions"><button className="secondary-button" disabled={state.context.captureAttempts.front >= 2} onClick={() => retake('front')}>Retake front</button><button className="secondary-button" disabled={state.context.captureAttempts.side >= 2} onClick={() => retake('side')}>Retake side</button></div></>}
    {state.matches('results') && <><MeasurementEstimateReview measurements={state.context.measurements} /><Notice>Shirt length is not directly observable because it depends on your preferred hem position. Enter and review it manually.</Notice><button className="primary-button" type="button" onClick={finish}>Review estimates in manual form</button></>}
    {state.matches('fatalError') && <Notice tone="error">Processing stopped safely: {state.context.error}. No failed measurement was converted to zero.</Notice>}
    <div className="page-actions"><button type="button" className="secondary-button" onClick={returnManual}><ArrowLeft size={17} aria-hidden="true" /> Return to manual measurements</button></div>
    <button type="button" className="text-button" onClick={() => { cleanup(); navigate('/measurements/photos') }}>Use existing photos instead</button>
  </section>
}
