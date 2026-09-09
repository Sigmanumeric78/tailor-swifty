import { describe, expect, it, vi } from 'vitest'
import { CameraModelRegistry } from '../services/modelRegistry'
import { MediaPipePoseService } from '../services/mediapipePoseService'

describe('progressive model services', () => {
  it('does not initialize BodyPix during live alignment', async () => {
    const pose = { initialize: vi.fn(), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const bodyPix = { initialize: vi.fn(), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const openCvLoader = vi.fn(async () => ({}))
    const registry = new CameraModelRegistry({ pose, bodyPixFactory: vi.fn(() => bodyPix), openCvLoader })
    await registry.initializeLive()
    expect(registry.liveReady).toBe(true); expect(bodyPix.initialize).not.toHaveBeenCalled(); expect(openCvLoader).not.toHaveBeenCalled()
    await registry.initializeSegmentation()
    expect(bodyPix.initialize).toHaveBeenCalledOnce(); expect(openCvLoader).toHaveBeenCalledOnce(); expect(registry.segmentationReady).toBe(true)
  })

  it('disposes resources when live initialization is cancelled', async () => {
    let resolvePose; const pose = { initialize: vi.fn(() => new Promise((resolve) => { resolvePose = resolve })), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const registry = new CameraModelRegistry({ pose, openCvLoader: vi.fn(async () => ({})) })
    const pending = registry.initializeLive(); registry.dispose(); resolvePose()
    await expect(pending).rejects.toThrow(/cancelled/)
    expect(pose.dispose).toHaveBeenCalled(); expect(registry.liveReady).toBe(false)
  })

  it('disposes a BodyPix instance that finishes initialization after cancellation', async () => {
    let resolveBodyPix
    const pose = { initialize: vi.fn(), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const bodyPix = { initialize: vi.fn(() => new Promise((resolve) => { resolveBodyPix = resolve })), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const registry = new CameraModelRegistry({ pose, bodyPixFactory: () => bodyPix, openCvLoader: vi.fn(async () => ({})) })
    await registry.initializeLive(); const pending = registry.initializeSegmentation(); await vi.waitFor(() => expect(resolveBodyPix).toBeTypeOf('function')); registry.dispose(); resolveBodyPix()
    await expect(pending).rejects.toThrow(/cancelled/)
    expect(bodyPix.dispose).toHaveBeenCalled(); expect(registry.segmentationReady).toBe(false)
  })

  it('keeps the primary path ready when secondary initialization fails', async () => {
    const pose = { initialize: vi.fn(), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const bodyPix = { initialize: vi.fn(async () => { throw new Error('BodyPix failed') }), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const registry = new CameraModelRegistry({ pose, bodyPixFactory: () => bodyPix, openCvLoader: vi.fn(async () => ({})) })
    await expect(registry.initialize()).resolves.toBe(registry)
    expect(bodyPix.dispose).toHaveBeenCalled(); expect(pose.dispose).not.toHaveBeenCalled(); expect(registry.ready).toBe(true)
    expect(registry.secondarySegmentationAvailable).toBe(false); expect(registry.segmentationWarnings).toEqual(['SECONDARY_SEGMENTER_UNAVAILABLE'])
  })

  it('disposes the registry when required OpenCV initialization fails', async () => {
    const pose = { initialize: vi.fn(), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const registry = new CameraModelRegistry({ pose, openCvLoader: vi.fn(async () => { throw new Error('OpenCV failed') }) })
    await expect(registry.initialize()).rejects.toThrow('OpenCV failed'); expect(pose.dispose).toHaveBeenCalled(); expect(registry.ready).toBe(false)
  })

  it('switches MediaPipe between VIDEO and IMAGE without redundant changes', async () => {
    const service = new MediaPipePoseService(); const mask = { width: 2, height: 1, getAsFloat32Array: () => new Float32Array([0, 1]), close: vi.fn() }; const liveMask = { ...mask, close: vi.fn() }
    service.landmarker = { setOptions: vi.fn(async () => {}), detectForVideo: vi.fn(() => ({ landmarks: [], segmentationMasks: [liveMask] })), detect: vi.fn(() => ({ landmarks: [[]], worldLandmarks: [[]], segmentationMasks: [mask] })) }
    service.runningMode = 'VIDEO'
    await service.detect({}, 100); await service.detect({}, 200)
    expect(service.landmarker.setOptions).not.toHaveBeenCalled(); expect(service.landmarker.detectForVideo).toHaveBeenCalledTimes(2); expect(liveMask.close).toHaveBeenCalledTimes(2)
    const result = await service.segment({ width: 2, height: 1 })
    expect(service.landmarker.setOptions).toHaveBeenCalledWith({ runningMode: 'IMAGE' }); expect(service.landmarker.detect).toHaveBeenCalledOnce(); expect(result.personCount).toBe(1); expect(mask.close).toHaveBeenCalledOnce()
    await service.segment({ width: 2, height: 1 })
    expect(service.landmarker.setOptions).toHaveBeenCalledTimes(1)
  })

  it('serializes IMAGE and VIDEO mode changes around concurrent inference', async () => {
    const service = new MediaPipePoseService(); const order = []
    service.landmarker = {
      setOptions: vi.fn(async ({ runningMode }) => { order.push(`mode:${runningMode}`) }),
      detect: vi.fn(() => { order.push('detect:IMAGE'); return { landmarks: [], segmentationMasks: [] } }),
      detectForVideo: vi.fn(() => { order.push('detect:VIDEO'); return { landmarks: [] } }),
    }
    service.runningMode = 'VIDEO'
    await Promise.all([service.segment({ width: 2, height: 2 }), service.detect({}, 10)])
    expect(order).toEqual(['mode:IMAGE', 'detect:IMAGE', 'mode:VIDEO', 'detect:VIDEO'])
  })
})
