export const PHYSICAL_REFERENCE_SPEC = Object.freeze({
  version: 'vertical-two-point-reference-1',
  separationMm: 500,
  placement: 'vertical-beside-torso-same-depth-plane',
  detectorStatus: 'BLOCKED_UNVALIDATED',
})

/** Synthetic integration fixture only; it is not evidence of physical accuracy. */
export const SYNTHETIC_REFERENCE_FIXTURE = Object.freeze({
  imageSize: { width: 800, height: 1200 },
  top: { x: 100, y: 250 }, bottom: { x: 100, y: 750 }, expectedMmPerPixel: 1,
})
