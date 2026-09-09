import { useEffect, useRef, useState } from 'react'
import Webcam from 'react-webcam'
import { scanConfig } from '../scanConfig'
import { cameraConstraintLadder } from '../hooks/useCameraStream'
import { evaluatePoseGate, namedLandmarks } from '../services/mediapipePoseService'
import { analyzePreviewQuality, luminanceMetrics } from '../services/opencvQualityService'
import { QualityChecklist } from './QualityChecklist'

export function CameraViewport({ registry, view, deviceId, onGranted, onDenied, onStable, onQuality, onVideoReady = () => {}, webcamRef }) {
  const localRef = useRef(null); const activeRef = webcamRef || localRef; const history = useRef([]); const luminanceHistory = useRef([]); const stableSince = useRef(null); const stableReported = useRef(false)
  const callbacks = useRef({ onQuality, onStable, onVideoReady })
  callbacks.current = { onQuality, onStable, onVideoReady }
  const [quality, setQuality] = useState({ passed: false, hardReasonCodes: ['NO_PERSON'], warningCodes: [], reasonCodes: ['NO_PERSON'] }); const [constraintIndex, setConstraintIndex] = useState(0)
  useEffect(() => { setConstraintIndex(0); callbacks.current.onVideoReady(false) }, [deviceId, view])
  useEffect(() => {
    history.current = []; luminanceHistory.current = []; stableSince.current = null; stableReported.current = false; setQuality({ passed: false, hardReasonCodes: ['NO_PERSON'], warningCodes: [], reasonCodes: ['NO_PERSON'] })
    if (!registry?.liveReady) return undefined
    let cancelled = false; let busy = false
    const timer = window.setInterval(async () => {
      const video = activeRef.current?.video
      if (busy || !video || video.readyState < 2) return
      if (!video.videoWidth || !video.videoHeight) { callbacks.current.onVideoReady(false); return }
      callbacks.current.onVideoReady(true)
      busy = true
      let context; let output
      try {
        const size = scanConfig.camera.previewMaxDimension; const scale = Math.min(1, size / Math.max(video.videoWidth, video.videoHeight))
        const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
        context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height); output = await registry.pose.detect(video, performance.now())
        const landmarks = output.landmarks || []
        const named = output.landmarks?.[0] ? namedLandmarks(output.landmarks[0]) : null
        if (landmarks.length === 1 && named) { history.current.push(named); history.current = history.current.slice(-scanConfig.pose.stableWindowFrames) } else { history.current = []; stableSince.current = null }
        const mask = output.segmentationMasks?.[0]; let bounds
        if (mask) {
          const data = mask.getAsFloat32Array(); let minX = 1; let maxX = 0; let minY = 1; let maxY = 0
          for (let index = 0; index < data.length; index += 1) if (data[index] >= scanConfig.mask.probabilityThreshold) { const x = (index % mask.width) / mask.width; const y = Math.floor(index / mask.width) / mask.height; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
          if (minX <= maxX && minY <= maxY) bounds = { minX, maxX, minY, maxY }
        }
        const pose = evaluatePoseGate({ poses: landmarks, view, maskBounds: bounds, history: history.current })
        const roiLuminance = luminanceMetrics(imageData, bounds).meanLuminance
        const previousLuminance = luminanceHistory.current.at(-1); luminanceHistory.current.push(roiLuminance); luminanceHistory.current = luminanceHistory.current.slice(-scanConfig.pose.stableWindowFrames)
        const imageMotion = Number.isFinite(previousLuminance) ? Math.abs(roiLuminance - previousLuminance) / 255 : 0
        const poseMotion = pose.motionScore === Infinity ? 0 : pose.motionScore
        const visual = analyzePreviewQuality(imageData, .8 * poseMotion + .2 * imageMotion, bounds)
        const hardReasonCodes = [...new Set([...pose.hardReasonCodes, ...visual.hardReasonCodes, ...(bounds ? [] : ['SEGMENTATION_MISSING'])])]
        const warningCodes = [...new Set([...pose.warningCodes, ...visual.warningCodes])]
        const combined = { ...visual, passed: hardReasonCodes.length === 0, hardReasonCodes, warningCodes, reasonCodes: [...hardReasonCodes, ...warningCodes], poseQuality: pose.poseQuality }
        if (!cancelled) {
          setQuality(combined); callbacks.current.onQuality({ ...combined, timestamp: performance.now() })
          if (combined.passed) {
            stableSince.current ||= performance.now()
            if (!stableReported.current && performance.now() - stableSince.current >= scanConfig.pose.stableDurationMs) { stableReported.current = true; callbacks.current.onStable() }
          } else { stableSince.current = null; stableReported.current = false }
        }
      } catch {
        history.current = []; luminanceHistory.current = []; stableSince.current = null; stableReported.current = false
        const failed = { passed: false, hardReasonCodes: ['MODEL_UNAVAILABLE'], warningCodes: [], reasonCodes: ['MODEL_UNAVAILABLE'] }
        if (!cancelled) { setQuality(failed); callbacks.current.onQuality(failed) }
      } finally {
        output?.segmentationMasks?.forEach((item) => item.close?.())
        if (context) { context.clearRect(0, 0, context.canvas.width, context.canvas.height); context.canvas.width = 0; context.canvas.height = 0 }
        busy = false
      }
    }, 250)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [activeRef, deviceId, registry, view])
  const constraints = cameraConstraintLadder(deviceId)
  const mediaReady = (stream) => { history.current = []; luminanceHistory.current = []; stableSince.current = null; stableReported.current = false; onGranted(stream); const video = activeRef.current?.video; callbacks.current.onVideoReady(Boolean(video?.videoWidth && video?.videoHeight)) }
  const mediaError = (error) => { callbacks.current.onVideoReady(false); if (constraintIndex < constraints.length - 1) setConstraintIndex((index) => index + 1); else onDenied(error) }
  return <div className="camera-shell"><div className="camera-frame"><Webcam key={`${deviceId || 'automatic'}-${constraintIndex}`} ref={activeRef} audio={false} playsInline mirrored={false} videoConstraints={constraints[constraintIndex]} onLoadedMetadata={() => { const video = activeRef.current?.video; callbacks.current.onVideoReady(Boolean(video?.videoWidth && video?.videoHeight)) }} onUserMedia={mediaReady} onUserMediaError={mediaError} /><div className="body-guide" aria-hidden="true" /></div><QualityChecklist {...quality} /></div>
}
