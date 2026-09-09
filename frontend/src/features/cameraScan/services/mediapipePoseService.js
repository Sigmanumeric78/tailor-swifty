import { scanConfig } from '../scanConfig'

export const landmarkNames = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner', 'right_eye', 'right_eye_outer', 'left_ear', 'right_ear',
  'mouth_left', 'mouth_right', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
  'left_pinky', 'right_pinky', 'left_index', 'right_index', 'left_thumb', 'right_thumb', 'left_hip', 'right_hip', 'left_knee',
  'right_knee', 'left_ankle', 'right_ankle', 'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index',
]

const frontCore = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip']
const frontAdvisory = ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle']
const sideCoreSuffixes = ['shoulder', 'hip', 'knee']
const sideAdvisorySuffixes = ['elbow', 'wrist']

export function namedLandmarks(points = []) {
  return Object.fromEntries(points.map((point, index) => [landmarkNames[index], { ...point, name: landmarkNames[index] }]))
}

const visibilityPresenceScore = (point) => point ? Math.min(point.visibility ?? 0, point.presence ?? 0) : 0
const isUsable = (point) => Boolean(point) && (point.visibility ?? 0) >= scanConfig.pose.landmarkVisibilityMin && (point.presence ?? 0) >= scanConfig.pose.landmarkPresenceMin

function requiredPoseLandmarks(landmarks, view) {
  if (view !== 'side') {
    const head = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear'].sort((first, second) => visibilityPresenceScore(landmarks[second]) - visibilityPresenceScore(landmarks[first]))[0]
    const endpoints = ['left', 'right'].map((side) => [`${side}_heel`, `${side}_foot_index`, `${side}_ankle`].sort((first, second) => visibilityPresenceScore(landmarks[second]) - visibilityPresenceScore(landmarks[first]))[0])
    const hardNames = [head, ...frontCore, ...endpoints]
    return { names: hardNames, motionNames: [...hardNames, ...frontAdvisory], hardNames, warningNames: frontAdvisory, nearSide: null, complete: hardNames.every((name) => isUsable(landmarks[name])) }
  }
  const chains = ['left', 'right'].map((side) => {
    const coreNames = sideCoreSuffixes.map((suffix) => `${side}_${suffix}`)
    const endpoint = [`${side}_heel`, `${side}_foot_index`, `${side}_ankle`].sort((first, second) => visibilityPresenceScore(landmarks[second]) - visibilityPresenceScore(landmarks[first]))[0]
    const names = [...coreNames, endpoint]
    return { side, names, warningNames: sideAdvisorySuffixes.map((suffix) => `${side}_${suffix}`), complete: names.every((name) => isUsable(landmarks[name])), score: names.reduce((sum, name) => sum + visibilityPresenceScore(landmarks[name]), 0) / names.length }
  }).sort((first, second) => Number(second.complete) - Number(first.complete) || second.score - first.score)
  const selected = chains[0]
  const headCandidates = ['nose', `${selected.side}_eye`, `${selected.side}_ear`].sort((first, second) => visibilityPresenceScore(landmarks[second]) - visibilityPresenceScore(landmarks[first]))
  const head = headCandidates[0]
  const hardNames = [head, ...selected.names]
  return { names: hardNames, motionNames: [...hardNames, ...selected.warningNames], hardNames, warningNames: selected.warningNames, nearSide: selected.side, complete: selected.complete && isUsable(landmarks[head]) }
}

export function landmarkMotion(history, names = [...frontCore, ...frontAdvisory]) {
  if (history.length < 2) return Infinity
  const movements = []
  for (let index = 1; index < history.length; index += 1) for (const name of names) {
    const previous = history[index - 1][name]; const current = history[index][name]
    if (isUsable(previous) && isUsable(current)) movements.push(Math.hypot(current.x - previous.x, current.y - previous.y))
  }
  if (!movements.length) return Infinity
  movements.sort((a, b) => a - b)
  return movements[Math.min(movements.length - 1, Math.floor(movements.length * .75))]
}

export function evaluatePoseGate({ poses = [], view, maskBounds, history = [] }) {
  if (!poses.length) return gate(['NO_PERSON'], [])
  if (poses.length > 1) return gate(['MULTIPLE_PEOPLE'], [])
  const landmarks = Array.isArray(poses[0]) ? namedLandmarks(poses[0]) : poses[0]
  const hardReasons = []; const warnings = []
  const requirement = requiredPoseLandmarks(landmarks, view)
  if (!requirement.complete) hardReasons.push('LANDMARKS_UNCERTAIN')
  if (requirement.warningNames.some((name) => !isUsable(landmarks[name]))) warnings.push('LANDMARKS_UNCERTAIN')
  const headY = Math.min(...['nose', `${requirement.nearSide}_eye`, `${requirement.nearSide}_ear`].filter((name) => landmarks[name]).map((name) => landmarks[name].y))
  const top = maskBounds?.minY ?? headY
  const bottom = maskBounds?.maxY ?? Math.max(landmarks.left_foot_index?.y || 0, landmarks.right_foot_index?.y || 0)
  const left = maskBounds?.minX ?? Math.min(...Object.values(landmarks).map((point) => point.x))
  const right = maskBounds?.maxX ?? Math.max(...Object.values(landmarks).map((point) => point.x))
  if (top < scanConfig.pose.topMarginMin) hardReasons.push('HEAD_OUT_OF_FRAME')
  if (bottom > 1 - scanConfig.pose.bottomMarginMin) hardReasons.push('FEET_OUT_OF_FRAME')
  if (left < scanConfig.pose.sideMarginMin) warnings.push('MOVE_RIGHT')
  if (right > 1 - scanConfig.pose.sideMarginMin) warnings.push('MOVE_LEFT')
  const occupancy = bottom - top
  if (occupancy < scanConfig.pose.severeBodyHeightFractionMin) hardReasons.push('BODY_TOO_SMALL')
  else if (occupancy < scanConfig.pose.bodyHeightFractionMin) warnings.push('BODY_TOO_SMALL')
  if (occupancy > scanConfig.pose.bodyHeightFractionMax) hardReasons.push('SEVERE_BODY_TRUNCATION')
  const shoulderWidth = Math.abs((landmarks.left_shoulder?.x || 0) - (landmarks.right_shoulder?.x || 0))
  const hipWidth = Math.abs((landmarks.left_hip?.x || 0) - (landmarks.right_hip?.x || 0))
  const shoulderLevel = Math.abs((landmarks.left_shoulder?.y || 0) - (landmarks.right_shoulder?.y || 0))
  const hipLevel = Math.abs((landmarks.left_hip?.y || 0) - (landmarks.right_hip?.y || 0))
  if (view === 'front' && (shoulderWidth < scanConfig.pose.frontPairWidthMin || hipWidth < scanConfig.pose.frontPairWidthMin || shoulderLevel > scanConfig.pose.frontLevelTolerance || hipLevel > scanConfig.pose.frontLevelTolerance)) hardReasons.push('WRONG_VIEW_ORIENTATION')
  if (view === 'side' && (shoulderWidth > scanConfig.pose.sidePairOverlapMax || hipWidth > scanConfig.pose.sidePairOverlapMax)) hardReasons.push('WRONG_VIEW_ORIENTATION')
  if (view === 'front') {
    const torsoXs = ['left_shoulder', 'right_shoulder', 'left_hip', 'right_hip'].map((name) => landmarks[name]?.x).filter(Number.isFinite)
    const torsoLeft = Math.min(...torsoXs)
    const torsoRight = Math.max(...torsoXs)
    const armsInside = [landmarks.left_elbow, landmarks.left_wrist, landmarks.right_elbow, landmarks.right_wrist].filter(Boolean).some((point) => point.x > torsoLeft && point.x < torsoRight)
    if (armsInside) warnings.push('ARMS_TOUCHING_TORSO')
  }
  const motionScore = landmarkMotion(history, requirement.motionNames)
  if (history.length >= scanConfig.pose.stableWindowFrames && motionScore > scanConfig.pose.normalizedMotionMax) warnings.push('SUBJECT_MOVING')
  const poseQuality = requirement.hardNames.reduce((sum, name) => sum + visibilityPresenceScore(landmarks[name]), 0) / requirement.hardNames.length
  return gate([...new Set(hardReasons)], [...new Set(warnings)], { landmarks, motionScore, occupancy, poseQuality, nearSide: requirement.nearSide, requiredLandmarkNames: requirement.hardNames })
}

function gate(hardReasonCodes, warningCodes, extra = {}) { return { passed: hardReasonCodes.length === 0, hardReasonCodes, warningCodes, reasonCodes: [...hardReasonCodes, ...warningCodes], ...extra } }

export class MediaPipePoseService {
  constructor() { this.landmarker = null; this.runningMode = null; this.operationQueue = Promise.resolve(); this.generation = 0 }
  async initialize() {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks('/models/mediapipe/wasm')
    this.landmarker = await PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: '/models/mediapipe/pose_landmarker_full.task' }, runningMode: 'VIDEO', numPoses: 2, outputSegmentationMasks: true })
    this.runningMode = 'VIDEO'; this.generation += 1
  }
  async setRunningMode(runningMode) {
    if (!this.landmarker) throw new Error('MediaPipe Pose Landmarker is not initialized')
    if (this.runningMode === runningMode) return
    await this.landmarker.setOptions({ runningMode }); this.runningMode = runningMode
  }
  queueOperation(runningMode, operation) {
    const generation = this.generation
    const pending = this.operationQueue.catch(() => {}).then(async () => {
      if (!this.landmarker || generation !== this.generation) throw new Error('MediaPipe Pose Landmarker is not initialized')
      await this.setRunningMode(runningMode)
      if (!this.landmarker || generation !== this.generation) throw new Error('MediaPipe operation was cancelled')
      return operation(this.landmarker)
    })
    this.operationQueue = pending.then(() => undefined, () => undefined)
    return pending
  }
  async detect(video, timestamp = performance.now()) { return this.queueOperation('VIDEO', (landmarker) => {
    const output = landmarker.detectForVideo(video, timestamp)
    const segmentationMasks = output.segmentationMasks?.map((mask) => {
      const values = new Float32Array(mask.getAsFloat32Array()); const copy = { width: mask.width, height: mask.height, getAsFloat32Array: () => values, close: () => {} }
      mask.close?.(); return copy
    }) || []
    return { ...output, segmentationMasks, personCount: output.landmarks?.length || 0 }
  }) }
  async segment(imageSource) { return this.queueOperation('IMAGE', async (landmarker) => {
    const started = performance.now(); const output = landmarker.detect(imageSource); const mask = output.segmentationMasks?.[0]
    try {
      const probabilityMask = mask ? new Float32Array(mask.getAsFloat32Array()) : null
      const width = mask?.width || imageSource.videoWidth || imageSource.width; const height = mask?.height || imageSource.videoHeight || imageSource.height
      const poses = output.landmarks || []
      const landmarks = poses[0] ? namedLandmarks(poses[0]) : null
      const worldLandmarks = output.worldLandmarks?.[0] ? namedLandmarks(output.worldLandmarks[0]) : null
      const foregroundFraction = probabilityMask ? probabilityMask.reduce((sum, value) => sum + (value >= scanConfig.mask.probabilityThreshold ? 1 : 0), 0) / probabilityMask.length : 0
      return { modelId: 'mediapipe-pose-landmarker-full-float16-v1', width, height, probabilityMask, poses, personCount: poses.length, landmarks, worldLandmarks, inferenceTimeMs: performance.now() - started, foregroundFraction, warnings: probabilityMask ? [] : ['MODEL_UNAVAILABLE'] }
    } finally { output.segmentationMasks?.forEach((item) => item.close?.()) }
  }) }
  getMetadata() { return { modelId: 'mediapipe-pose-landmarker-full-float16-v1', runningMode: this.runningMode, numPoses: 2, outputSegmentationMasks: true } }
  dispose() { this.generation += 1; this.landmarker?.close(); this.landmarker = null; this.runningMode = null; this.operationQueue = Promise.resolve() }
}
