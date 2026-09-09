export const PIPELINE_VERSION = 'camera-measurement-0.2.1'

// Provisional engineering thresholds. They require validation and are not scientifically established.
export const scanConfig = Object.freeze({
  heightMm: { min: 1000, max: 2500, inputUncertaintyMm: 10 },
  camera: { widthIdeal: 1920, heightIdeal: 1080, fallbackWidthIdeal: 1280, fallbackHeightIdeal: 720, previewMaxDimension: 640 },
  capture: { burstSize: 8, selectedFrames: 3, minimumSeparationMs: 150, maximumBurstsPerView: 2 },
  pose: {
    landmarkVisibilityMin: 0.55, landmarkPresenceMin: 0.5, bodyHeightFractionMin: 0.65, severeBodyHeightFractionMin: 0.5,
    bodyHeightFractionMax: 0.92, topMarginMin: 0.02, bottomMarginMin: 0.01, sideMarginMin: 0.04,
    stableWindowFrames: 12, stableDurationMs: 2000, normalizedMotionMax: 0.015,
    readinessWindowMs: 2000, readinessMinimumSamples: 5, readinessPassRatioMin: 0.8,
    countdownHardFailureSamples: 3,
    frontPairWidthMin: 0.08, frontLevelTolerance: 0.06, sidePairOverlapMax: 0.075,
  },
  quality: {
    sharpnessMin: 80, previewSharpnessMin: 8, severeSharpnessMin: 3,
    luminanceMin: 45, luminanceMax: 215, severeLuminanceMin: 22, severeLuminanceMax: 238,
    darkFractionMax: 0.35, severeDarkFractionMax: 0.72, highlightFractionMax: 0.2, severeHighlightFractionMax: 0.55,
    contrastMin: 28, roiPaddingFraction: 0.08,
  },
  mask: { probabilityThreshold: 0.55, minimumForegroundFraction: 0.08, maximumForegroundFraction: 0.75 },
  consensus: { iouMin: 0.72, boundaryDisagreementMax: 0.2, boundaryToleranceFraction: 0.015, boundaryToleranceMinPx: 3, boundaryToleranceMaxPx: 12, heightDisagreementMax: 0.05, torsoWidthDisagreementMax: 0.12 },
  calibration: { boundaryUncertaintyPx: 3, maskLandmarkExtentTolerance: 0.15, aspectRatioMin: 1.7, aspectRatioMax: 5.5 },
  slices: {
    neck: { shoulderOffset: -0.08, band: 0.015 }, chest: { shoulderToHip: 0.28, band: 0.02 },
    waist: { shoulderToHipStart: 0.52, shoulderToHipEnd: 0.82, band: 0.02 }, hip: { hipOffsetStart: -0.05, hipOffsetEnd: 0.12, band: 0.02 },
  },
  repeats: { madMultiplier: 3, minimumValid: 3, toleranceFraction: { default: 0.04, sleeve_length: 0.05, armhole_depth: 0.08 } },
  confidence: {
    weights: { captureQuality: 0.17, poseQuality: 0.17, segmentationQuality: 0.15, calibrationQuality: 0.13, repeatConsistency: 0.17, observability: 0.05, frontSideScaleAgreement: 0.08, cameraMetadata: 0.03, clothingFit: 0.05 },
    highMin: 0.75, mediumMin: 0.55, warningPenaltyPerCode: 0.05, minimumWarningMultiplier: 0.6,
  },
})
