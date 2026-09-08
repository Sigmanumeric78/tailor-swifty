import { describe, expect, it, vi } from 'vitest'
import { CameraModelRegistry } from '../services/modelRegistry'
import { MediaPipePoseService } from '../services/mediapipePoseService'

describe('progressive model services', () => {
  it('does not initialize BodyPix during live alignment', async () => {
    const pose = { initialize: vi.fn(), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const bodyPix = { initialize: vi.fn(), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const registry = new CameraModelRegistry({ pose, bodyPixFactory: vi.fn(() => bodyPix), openCvLoader: vi.fn(async () => ({})) })
    await registry.initializeLive()
    expect(registry.liveReady).toBe(true); expect(bodyPix.initialize).not.toHaveBeenCalled()
    await registry.initializeSegmentation()
    expect(bodyPix.initialize).toHaveBeenCalledOnce(); expect(registry.segmentationReady).toBe(true)
  })

  it('disposes resources when live initialization is cancelled', async () => {
    let resolvePose; const pose = { initialize: vi.fn(() => new Promise((resolve) => { resolvePose = resolve })), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const registry = new CameraModelRegistry({ pose, openCvLoader: vi.fn(async () => ({})) })
    const pending = registry.initializeLive(); registry.dispose(); resolvePose()
    await expect(pending).rejects.toThrow(/cancelled/)
    expect(pose.dispose).toHaveBeenCalled(); expect(registry.liveReady).toBe(false)
  })

  it('disposes both stages when full initialization fails', async () => {
    const pose = { initialize: vi.fn(), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const bodyPix = { initialize: vi.fn(async () => { throw new Error('BodyPix failed') }), dispose: vi.fn(), getMetadata: vi.fn(() => ({})) }
    const registry = new CameraModelRegistry({ pose, bodyPixFactory: () => bodyPix, openCvLoader: vi.fn(async () => ({})) })
    await expect(registry.initialize()).rejects.toThrow('BodyPix failed')
    expect(bodyPix.dispose).toHaveBeenCalled(); expect(pose.dispose).toHaveBeenCalled(); expect(registry.ready).toBe(false)
  })

  it('switches MediaPipe between VIDEO and IMAGE without redundant changes', async () => {
    const service = new MediaPipePoseService(); const mask = { width: 2, height: 1, getAsFloat32Array: () => new Float32Array([0, 1]), close: vi.fn() }
    service.landmarker = { setOptions: vi.fn(async () => {}), detectForVideo: vi.fn(() => ({ landmarks: [] })), detect: vi.fn(() => ({ landmarks: [[]], worldLandmarks: [[]], segmentationMasks: [mask] })) }
    service.runningMode = 'VIDEO'
    await service.detect({}, 100); await service.detect({}, 200)
    expect(service.landmarker.setOptions).not.toHaveBeenCalled(); expect(service.landmarker.detectForVideo).toHaveBeenCalledTimes(2)
    const result = await service.segment({ width: 2, height: 1 })
    expect(service.landmarker.setOptions).toHaveBeenCalledWith({ runningMode: 'IMAGE' }); expect(service.landmarker.detect).toHaveBeenCalledOnce(); expect(result.personCount).toBe(1); expect(mask.close).toHaveBeenCalledOnce()
    await service.segment({ width: 2, height: 1 })
    expect(service.landmarker.setOptions).toHaveBeenCalledTimes(1)
  })
})
