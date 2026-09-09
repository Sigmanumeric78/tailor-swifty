import React, { createRef } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CameraViewport } from '../components/CameraViewport'

vi.mock('react-webcam', async () => {
  const ReactModule = await import('react')
  return { default: ReactModule.forwardRef(function FakeWebcam(_props, ref) {
    ReactModule.useImperativeHandle(ref, () => ({ video: { readyState: 2, videoWidth: 640, videoHeight: 480 } }), [])
    return <div data-testid="fake-webcam" />
  }) }
})

vi.mock('../services/opencvQualityService', () => ({ analyzePreviewQuality: () => ({ passed: true, hardReasonCodes: [], warningCodes: [], reasonCodes: [], sharpnessScore: 100, meanLuminance: 120, darkFraction: 0, highlightFraction: 0, contrastScore: 40, motionScore: 0 }) }))

const canvasContext = function canvasContext() { return { canvas: this, drawImage: vi.fn(), getImageData: vi.fn(() => ({ width: 640, height: 480, data: new Uint8ClampedArray(640 * 480 * 4) })), clearRect: vi.fn() } }

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('camera preview analysis lifecycle', () => {
  it('does not restart the analysis interval when callback identities change', async () => {
    vi.useFakeTimers(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(canvasContext)
    const detect = vi.fn(async () => ({ landmarks: [] })); const registry = { liveReady: true, pose: { detect }, cv: {} }; const webcamRef = createRef()
    const rendered = render(<CameraViewport registry={registry} view="front" deviceId="" webcamRef={webcamRef} onQuality={() => {}} onStable={() => {}} />)
    for (let index = 0; index < 3; index += 1) {
      await act(async () => { vi.advanceTimersByTime(100); await Promise.resolve() })
      rendered.rerender(<CameraViewport registry={registry} view="front" deviceId="" webcamRef={webcamRef} onQuality={() => {}} onStable={() => {}} />)
    }
    expect(detect).toHaveBeenCalledOnce()
  })

  it('clears stale passing quality when model analysis throws', async () => {
    vi.useFakeTimers(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(canvasContext)
    const onQuality = vi.fn(); const registry = { liveReady: true, pose: { detect: vi.fn(async () => { throw new Error('model failed') }) }, cv: {} }
    render(<CameraViewport registry={registry} view="side" deviceId="" webcamRef={createRef()} onQuality={onQuality} onStable={() => {}} />)
    await act(async () => { vi.advanceTimersByTime(250); await Promise.resolve() })
    expect(onQuality).toHaveBeenCalledWith(expect.objectContaining({ passed: false, hardReasonCodes: ['MODEL_UNAVAILABLE'], reasonCodes: ['MODEL_UNAVAILABLE'] }))
  })
})
