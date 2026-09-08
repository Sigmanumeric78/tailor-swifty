import { useEffect, useRef, useState } from 'react'
import Webcam from 'react-webcam'
import { scanConfig } from '../scanConfig'
import { evaluatePoseGate, namedLandmarks } from '../services/mediapipePoseService'
import { analyzeImageQuality } from '../services/opencvQualityService'
import { QualityChecklist } from './QualityChecklist'

export function CameraViewport({ registry, view, deviceId, onGranted, onDenied, onStable, onQuality, webcamRef }) {
  const localRef = useRef(null); const activeRef = webcamRef || localRef; const history = useRef([]); const stableSince = useRef(null)
  const callbacks = useRef({ onQuality, onStable })
  callbacks.current = { onQuality, onStable }
  const [quality, setQuality] = useState({ passed: false, reasonCodes: ['NO_PERSON'] })
  useEffect(() => {
    history.current = []; stableSince.current = null; setQuality({ passed: false, reasonCodes: ['NO_PERSON'] })
    if (!registry?.liveReady) return undefined
    let cancelled = false; let busy = false
    const timer = window.setInterval(async () => {
      const video = activeRef.current?.video
      if (busy || !video || video.readyState < 2) return
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
        const visual = analyzeImageQuality(registry.cv, imageData, pose.motionScore === Infinity ? 0 : pose.motionScore)
        const maskReasons = bounds ? [] : ['SEGMENTATION_UNSTABLE']
        const combined = { ...visual, passed: pose.passed && visual.passed && Boolean(bounds), reasonCodes: [...new Set([...pose.reasonCodes, ...visual.reasonCodes, ...maskReasons])], poseQuality: pose.poseQuality }
        if (!cancelled) { setQuality(combined); callbacks.current.onQuality(combined); if (combined.passed) { stableSince.current ||= performance.now(); if (performance.now() - stableSince.current >= scanConfig.pose.stableDurationMs) callbacks.current.onStable() } else stableSince.current = null }
      } catch {
        history.current = []; stableSince.current = null
        const failed = { passed: false, reasonCodes: ['MODEL_UNAVAILABLE'] }
        if (!cancelled) { setQuality(failed); callbacks.current.onQuality(failed) }
      } finally {
        output?.segmentationMasks?.forEach((item) => item.close?.())
        context?.clearRect(0, 0, context.canvas.width, context.canvas.height)
        busy = false
      }
    }, 250)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [activeRef, deviceId, registry, view])
  return <div className="camera-shell"><div className="camera-frame"><Webcam ref={activeRef} audio={false} playsInline mirrored={false} videoConstraints={{ facingMode: { ideal: 'environment' }, width: { ideal: 1920, min: 1280 }, height: { ideal: 1080, min: 720 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) }} onUserMedia={onGranted} onUserMediaError={onDenied} /><div className="body-guide" aria-hidden="true" /></div><QualityChecklist {...quality} /></div>
}
