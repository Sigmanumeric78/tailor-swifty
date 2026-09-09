import { describe, expect, it } from 'vitest'
import { evaluatePoseGate, landmarkNames, namedLandmarks } from '../services/mediapipePoseService'

function pose(view = 'front') {
  const points = landmarkNames.map(() => ({ x: 0.5, y: 0.5, visibility: 1, presence: 1 }))
  const set = (name, x, y) => { points[landmarkNames.indexOf(name)] = { x, y, visibility: 1, presence: 1 } }
  set('nose', 0.5, 0.08); set('left_shoulder', view === 'front' ? 0.4 : 0.49, 0.25); set('right_shoulder', view === 'front' ? 0.6 : 0.51, 0.25)
  set('left_elbow', view === 'front' ? 0.34 : 0.47, 0.4); set('right_elbow', view === 'front' ? 0.66 : 0.53, 0.4); set('left_wrist', view === 'front' ? 0.3 : 0.46, 0.55); set('right_wrist', view === 'front' ? 0.7 : 0.54, 0.55)
  set('left_hip', view === 'front' ? 0.44 : 0.495, 0.52); set('right_hip', view === 'front' ? 0.56 : 0.505, 0.52)
  for (const [name, x, y] of [['left_knee', .45, .72], ['right_knee', .55, .72], ['left_ankle', .45, .88], ['right_ankle', .55, .88], ['left_heel', .45, .91], ['right_heel', .55, .91], ['left_foot_index', .44, .92], ['right_foot_index', .56, .92]]) set(name, x, y)
  return points
}
const obscureSide = (points, side) => {
  for (const suffix of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'foot_index']) {
    const point = points[landmarkNames.indexOf(`${side}_${suffix}`)]
    point.visibility = .1; point.presence = .1
  }
  const eye = points[landmarkNames.indexOf(`${side}_eye`)]; eye.visibility = .1; eye.presence = .1
  const ear = points[landmarkNames.indexOf(`${side}_ear`)]; ear.visibility = .1; ear.presence = .1
  return points
}
const bounds = { minX: .2, maxX: .8, minY: .04, maxY: .93 }

describe('pose gates', () => {
  it('rejects no person and multiple people', () => { expect(evaluatePoseGate({ poses: [], view: 'front' }).reasonCodes).toContain('NO_PERSON'); expect(evaluatePoseGate({ poses: [pose(), pose()], view: 'front' }).reasonCodes).toContain('MULTIPLE_PEOPLE') })
  it('rejects truncated head and feet', () => { expect(evaluatePoseGate({ poses: [pose()], view: 'front', maskBounds: { ...bounds, minY: 0 } }).reasonCodes).toContain('HEAD_OUT_OF_FRAME'); expect(evaluatePoseGate({ poses: [pose()], view: 'front', maskBounds: { ...bounds, maxY: 1 } }).reasonCodes).toContain('FEET_OUT_OF_FRAME') })
  it('accepts valid front and side views', () => { expect(evaluatePoseGate({ poses: [pose()], view: 'front', maskBounds: bounds }).passed).toBe(true); expect(evaluatePoseGate({ poses: [pose('side')], view: 'side', maskBounds: bounds }).passed).toBe(true) })
  it('keeps uncertain front elbows and wrists advisory for torso capture', () => {
    const front = pose()
    for (const name of ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist']) { front[landmarkNames.indexOf(name)].visibility = .1; front[landmarkNames.indexOf(name)].presence = .1 }
    const result = evaluatePoseGate({ poses: [front], view: 'front', maskBounds: bounds })
    expect(result.passed).toBe(true); expect(result.warningCodes).toContain('LANDMARKS_UNCERTAIN'); expect(result.hardReasonCodes).not.toContain('LANDMARKS_UNCERTAIN')
  })
  it('accepts a complete near-side profile when the far side is occluded', () => { const result = evaluatePoseGate({ poses: [obscureSide(pose('side'), 'right')], view: 'side', maskBounds: bounds }); expect(result.passed).toBe(true); expect(result.nearSide).toBe('left'); expect(result.poseQuality).toBeGreaterThanOrEqual(.55) })
  it('rejects a profile without any complete near-side chain', () => { const profile = obscureSide(obscureSide(pose('side'), 'right'), 'left'); expect(evaluatePoseGate({ poses: [profile], view: 'side', maskBounds: bounds }).reasonCodes).toContain('LANDMARKS_UNCERTAIN') })
  it('rejects wrong orientations', () => { expect(evaluatePoseGate({ poses: [pose('side')], view: 'front', maskBounds: bounds }).hardReasonCodes).toContain('WRONG_VIEW_ORIENTATION'); expect(evaluatePoseGate({ poses: [pose()], view: 'side', maskBounds: bounds }).hardReasonCodes).toContain('WRONG_VIEW_ORIENTATION') })
  it('normalizes torso bounds when screen left and anatomical left are reversed', () => { const reversed = pose(); const named = namedLandmarks(reversed); for (const name of ['left_shoulder', 'left_hip']) named[name].x = .62; for (const name of ['right_shoulder', 'right_hip']) named[name].x = .38; named.left_elbow.x = .72; named.left_wrist.x = .75; named.right_elbow.x = .28; named.right_wrist.x = .25; expect(evaluatePoseGate({ poses: [named], view: 'front', maskBounds: bounds }).reasonCodes).not.toContain('ARMS_TOUCHING_TORSO') })
  it('detects unstable landmark history', () => { const first = namedLandmarks(pose()); const moved = Object.fromEntries(Object.entries(first).map(([name, point]) => [name, { ...point, x: point.x + .03 }])); const history = Array.from({ length: 12 }, (_, index) => index % 2 ? first : moved); expect(evaluatePoseGate({ poses: [pose()], view: 'front', maskBounds: bounds, history }).reasonCodes).toContain('SUBJECT_MOVING') })
})
