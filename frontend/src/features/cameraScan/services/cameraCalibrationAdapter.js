export const CameraCapabilityTier = Object.freeze({ WEB_BASIC: 'WEB_BASIC', NATIVE_INTRINSICS: 'NATIVE_INTRINSICS', NATIVE_DEPTH: 'NATIVE_DEPTH' })

/** Browser APIs do not expose standardized camera intrinsics or depth. Never guess them. */
export class WebCameraCalibrationAdapter {
  getCalibration() {
    return {
      capabilityTier: CameraCapabilityTier.WEB_BASIC,
      focalLengthPixels: null, principalPoint: null, imageDimensions: null, distortionCoefficients: null,
      depthAvailable: false, depthConfidence: null, cameraTransform: null, activeLensIdentifier: null,
      warnings: ['BROWSER_INTRINSICS_UNAVAILABLE', 'DEPTH_UNAVAILABLE'],
    }
  }
}
