import { scanConfig } from '../scanConfig'

export const landmarkNames = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner', 'right_eye', 'right_eye_outer', 'left_ear', 'right_ear',
  'mouth_left', 'mouth_right', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
  'left_pinky', 'right_pinky', 'left_index', 'right_index', 'left_thumb', 'right_thumb', 'left_hip', 'right_hip', 'left_knee',
  'right_knee', 'left_ankle', 'right_ankle', 'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index',
]

const required = ['nose', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index']

export function namedLandmarks(points = []) {
  return Object.fromEntries(points.map((point, index) => [landmarkNames[index], { ...point, name: landmarkNames[index] }]))
}

export function landmarkMotion(history) {
  if (history.length < 2) return Infinity
  const names = ['nose', 'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip', 'left_ankle', 'right_ankle']
  const movements = []
  for (let index = 1; index < history.length; index += 1) for (const name of names) {
    const previous = history[index - 1][name]; const current = history[index][name]
    if (previous && current) movements.push(Math.hypot(current.x - previous.x, current.y - previous.y))
  }
  return movements.length ? Math.max(...movements) : Infinity
}

export function evaluatePoseGate({ poses = [], view, maskBounds, history = [] }) {
  if (!poses.length) return gate(['NO_PERSON'])
  if (poses.length > 1) return gate(['MULTIPLE_PEOPLE'])
  const landmarks = Array.isArray(poses[0]) ? namedLandmarks(poses[0]) : poses[0]
  const reasons = []
  if (required.some((name) => !landmarks[name] || (landmarks[name].visibility ?? 1) < scanConfig.pose.landmarkVisibilityMin || (landmarks[name].presence ?? 1) < scanConfig.pose.landmarkPresenceMin)) reasons.push('LANDMARKS_UNCERTAIN')
  const top = maskBounds?.minY ?? landmarks.nose?.y
  const bottom = maskBounds?.maxY ?? Math.max(landmarks.left_foot_index?.y || 0, landmarks.right_foot_index?.y || 0)
  const left = maskBounds?.minX ?? Math.min(...Object.values(landmarks).map((point) => point.x))
  const right = maskBounds?.maxX ?? Math.max(...Object.values(landmarks).map((point) => point.x))
  if (top < scanConfig.pose.topMarginMin) reasons.push('HEAD_OUT_OF_FRAME')
  if (bottom > 1 - scanConfig.pose.bottomMarginMin) reasons.push('FEET_OUT_OF_FRAME')
  if (left < scanConfig.pose.sideMarginMin) reasons.push('MOVE_RIGHT')
  if (right > 1 - scanConfig.pose.sideMarginMin) reasons.push('MOVE_LEFT')
  const occupancy = bottom - top
  if (occupancy < scanConfig.pose.bodyHeightFractionMin) reasons.push('BODY_TOO_SMALL')
  if (occupancy > scanConfig.pose.bodyHeightFractionMax) reasons.push('BODY_TOO_LARGE')
  const shoulderWidth = Math.abs((landmarks.left_shoulder?.x || 0) - (landmarks.right_shoulder?.x || 0))
  const hipWidth = Math.abs((landmarks.left_hip?.x || 0) - (landmarks.right_hip?.x || 0))
  const shoulderLevel = Math.abs((landmarks.left_shoulder?.y || 0) - (landmarks.right_shoulder?.y || 0))
  const hipLevel = Math.abs((landmarks.left_hip?.y || 0) - (landmarks.right_hip?.y || 0))
  if (view === 'front' && (shoulderWidth < scanConfig.pose.frontPairWidthMin || hipWidth < scanConfig.pose.frontPairWidthMin || shoulderLevel > scanConfig.pose.frontLevelTolerance || hipLevel > scanConfig.pose.frontLevelTolerance)) reasons.push('NOT_FRONT_FACING')
  if (view === 'side' && (shoulderWidth > scanConfig.pose.sidePairOverlapMax || hipWidth > scanConfig.pose.sidePairOverlapMax)) reasons.push('NOT_SIDE_FACING')
  if (view === 'front') {
    const torsoLeft = Math.min(landmarks.left_shoulder?.x || 0, landmarks.left_hip?.x || 0)
    const torsoRight = Math.max(landmarks.right_shoulder?.x || 0, landmarks.right_hip?.x || 0)
    const armsInside = [landmarks.left_elbow, landmarks.left_wrist, landmarks.right_elbow, landmarks.right_wrist].filter(Boolean).some((point) => point.x > torsoLeft && point.x < torsoRight)
    if (armsInside) reasons.push('ARMS_TOUCHING_TORSO')
  }
  const motionScore = landmarkMotion(history)
  if (history.length >= scanConfig.pose.stableWindowFrames && motionScore > scanConfig.pose.normalizedMotionMax) reasons.push('SUBJECT_MOVING')
  return gate([...new Set(reasons)], { landmarks, motionScore, occupancy, poseQuality: Math.max(0, 1 - reasons.length * 0.15) })
}

function gate(reasonCodes, extra = {}) { return { passed: reasonCodes.length === 0, reasonCodes, ...extra } }

export class MediaPipePoseService {
  constructor() { this.landmarker = null }
  async initialize() {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks('/models/mediapipe/wasm')
    this.landmarker = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: '/models/mediapipe/pose_landmarker_full.task' }, runningMode: 'VIDEO', numPoses: 2, outputSegmentationMasks: true })
  }
  detect(video, timestamp = performance.now()) { return this.landmarker.detectForVideo(video, timestamp) }
  async segment(imageSource, { timestamp = performance.now() } = {}) {
    const started = performance.now(); const output = this.detect(imageSource, timestamp); const mask = output.segmentationMasks?.[0]
    const probabilityMask = mask ? new Float32Array(mask.getAsFloat32Array()) : null
    const width = mask?.width || imageSource.videoWidth || imageSource.width; const height = mask?.height || imageSource.videoHeight || imageSource.height
    const landmarks = output.landmarks?.[0] ? namedLandmarks(output.landmarks[0]) : null
    const worldLandmarks = output.worldLandmarks?.[0] ? namedLandmarks(output.worldLandmarks[0]) : null
    output.segmentationMasks?.forEach((item) => item.close?.())
    const foregroundFraction = probabilityMask ? probabilityMask.reduce((sum, value) => sum + (value >= scanConfig.mask.probabilityThreshold ? 1 : 0), 0) / probabilityMask.length : 0
    return { modelId: 'mediapipe-pose-landmarker-full-float16-v1', width, height, probabilityMask, landmarks, worldLandmarks, inferenceTimeMs: performance.now() - started, foregroundFraction, warnings: probabilityMask ? [] : ['MODEL_UNAVAILABLE'] }
  }
  getMetadata() { return { modelId: 'mediapipe-pose-landmarker-full-float16-v1', runningMode: 'VIDEO', numPoses: 2, outputSegmentationMasks: true } }
  dispose() { this.landmarker?.close(); this.landmarker = null }
}
