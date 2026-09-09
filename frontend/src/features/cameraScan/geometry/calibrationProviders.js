import { calibrateKnownHeight } from './calibration'
import { PHYSICAL_REFERENCE_SPEC } from './physicalReference'

export const CalibrationMode = Object.freeze({
  VERIFIED_HEIGHT: 'VERIFIED_HEIGHT', PHYSICAL_REFERENCE: 'PHYSICAL_REFERENCE',
  NATIVE_INTRINSICS_DEPTH: 'NATIVE_INTRINSICS_DEPTH', UNAVAILABLE: 'UNAVAILABLE',
})

export class VerifiedHeightCalibrationProvider {
  mode = CalibrationMode.VERIFIED_HEIGHT
  calibrate(input) {
    const calibration = calibrateKnownHeight(input)
    return {
      ...calibration,
      confidence: calibration.confidence * 0.85,
      warnings: [...new Set([...(calibration.warnings || []), 'WEAK_PERSPECTIVE_CALIBRATION'])],
      mode: this.mode,
      projectionModel: 'weak-perspective',
    }
  }
}

export class UnavailableCalibrationProvider {
  constructor(mode, reason) { this.mode = mode; this.reason = reason }
  calibrate() { return { mode: CalibrationMode.UNAVAILABLE, requestedMode: this.mode, mmPerPixel: null, confidence: 0, warnings: [this.reason] } }
}

export function calibrationProviderFor(mode) {
  if (mode === CalibrationMode.VERIFIED_HEIGHT) return new VerifiedHeightCalibrationProvider()
  if (mode === CalibrationMode.PHYSICAL_REFERENCE) {
    const provider = new UnavailableCalibrationProvider(mode, 'PHYSICAL_REFERENCE_DETECTOR_UNAVAILABLE'); provider.referenceSpec = PHYSICAL_REFERENCE_SPEC; return provider
  }
  if (mode === CalibrationMode.NATIVE_INTRINSICS_DEPTH) return new UnavailableCalibrationProvider(mode, 'NATIVE_CALIBRATION_UNAVAILABLE')
  return new UnavailableCalibrationProvider(mode, 'CALIBRATION_UNAVAILABLE')
}
