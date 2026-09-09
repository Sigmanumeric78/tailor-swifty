import { describe, expect, it, vi } from 'vitest'
import { CalibrationMode, calibrationProviderFor } from '../geometry/calibrationProviders'
import { WebCameraCalibrationAdapter } from '../services/cameraCalibrationAdapter'
import { DeviceOrientationAdapter } from '../services/deviceOrientationService'
import { UnavailableSizeEstimateProvider } from '../services/sizeEstimateProvider'
import { SYNTHETIC_REFERENCE_FIXTURE } from '../geometry/physicalReference'

describe('optional platform and calibration adapters', () => {
  it('reports browser intrinsics and depth as unsupported instead of guessing', () => {
    expect(new WebCameraCalibrationAdapter().getCalibration()).toMatchObject({ focalLengthPixels: null, depthAvailable: false, activeLensIdentifier: null, capabilityTier: 'WEB_BASIC' })
  })
  it('keeps verified-height and unavailable calibration modes explicit', () => {
    const mask = new Uint8Array(40 * 100); for (let y = 5; y < 95; y += 1) for (let x = 10; x < 30; x += 1) mask[y * 40 + x] = 1
    expect(calibrationProviderFor(CalibrationMode.VERIFIED_HEIGHT).calibrate({ heightMm: 1800, mask, width: 40, height: 100 })).toMatchObject({ mode: 'VERIFIED_HEIGHT', projectionModel: 'weak-perspective', mmPerPixel: 20, warnings: ['WEAK_PERSPECTIVE_CALIBRATION'] })
    const reference = calibrationProviderFor(CalibrationMode.PHYSICAL_REFERENCE); expect(reference.calibrate()).toMatchObject({ mode: 'UNAVAILABLE', requestedMode: 'PHYSICAL_REFERENCE', mmPerPixel: null }); expect(reference.referenceSpec).toMatchObject({ separationMm: 500, detectorStatus: 'BLOCKED_UNVALIDATED' }); expect(SYNTHETIC_REFERENCE_FIXTURE.expectedMmPerPixel).toBe(1)
  })
  it('returns an explicit unavailable result when no approved size chart exists', () => { expect(new UnavailableSizeEstimateProvider().estimate()).toMatchObject({ status: 'UNAVAILABLE_NO_SIZE_CHART', measurements: null }) })
  it('degrades when orientation is unavailable or denied and removes listeners', async () => {
    await expect(new DeviceOrientationAdapter({}).start()).resolves.toMatchObject({ status: 'unavailable' })
    await expect(new DeviceOrientationAdapter({ DeviceOrientationEvent: { requestPermission: vi.fn(async () => 'denied') } }).start()).resolves.toMatchObject({ status: 'denied' })
    const environment = { DeviceOrientationEvent: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(), performance: { now: () => 10 } }; const active = new DeviceOrientationAdapter(environment); const update = vi.fn()
    await expect(active.start(update)).resolves.toMatchObject({ status: 'active' }); const listener = environment.addEventListener.mock.calls[0][1]; listener({ beta: 4, gamma: -3 })
    expect(update).toHaveBeenCalledWith({ pitch: 4, roll: -3, timestamp: 10 }); active.dispose(); expect(environment.removeEventListener).toHaveBeenCalledWith('deviceorientation', listener)
  })
})
