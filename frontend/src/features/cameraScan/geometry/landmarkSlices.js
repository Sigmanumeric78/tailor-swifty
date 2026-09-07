import { scanConfig } from '../scanConfig'

const averageY = (landmarks, names) => names.reduce((sum, name) => sum + landmarks[name].y, 0) / names.length

export function anatomicalSlicePositions(landmarks, imageHeight) {
  const shoulderY = averageY(landmarks, ['left_shoulder', 'right_shoulder'])
  const hipY = averageY(landmarks, ['left_hip', 'right_hip'])
  const torso = hipY - shoulderY
  return {
    neck: (shoulderY + scanConfig.slices.neck.shoulderOffset * torso) * imageHeight,
    chest: (shoulderY + scanConfig.slices.chest.shoulderToHip * torso) * imageHeight,
    waistBand: [(shoulderY + scanConfig.slices.waist.shoulderToHipStart * torso) * imageHeight, (shoulderY + scanConfig.slices.waist.shoulderToHipEnd * torso) * imageHeight],
    hipBand: [(hipY + scanConfig.slices.hip.hipOffsetStart * torso) * imageHeight, (hipY + scanConfig.slices.hip.hipOffsetEnd * torso) * imageHeight],
  }
}
