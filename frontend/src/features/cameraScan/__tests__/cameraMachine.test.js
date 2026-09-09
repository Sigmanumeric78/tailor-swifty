import { createActor } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import { cameraMachine, updateRollingReadiness } from '../cameraMachine'

const frames = [1, 2, 3].map((id) => ({ id }))
const actorAt = (events = []) => { const actor = createActor(cameraMachine).start(); events.forEach((event) => actor.send(event)); return actor }
const reachFrontAligning = () => actorAt([{ type: 'START' }, { type: 'CAMERA_GRANTED' }, { type: 'MODELS_READY' }, { type: 'SET_HEIGHT_MM', heightMm: 1800 }, { type: 'START' }])
const passView = (actor) => { actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, hardReasonCodes: [], warningCodes: [] }); actor.send({ type: 'CAPTURE_NOW' }); actor.send({ type: 'BURST_COMPLETE', frames, selectedFrames: frames }); actor.send({ type: 'ACCEPT_CAPTURE' }) }
const primeAutoCountdown = (actor) => { actor.send({ type: 'SET_CAPTURE_MODE', mode: 'auto' }); for (let index = 0; index < 5; index += 1) actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, hardReasonCodes: [], warningCodes: [], timestamp: index * 250 }); actor.send({ type: 'POSE_STABLE' }) }

describe('camera machine', () => {
  it('follows the happy path without hardware', () => { const actor = reachFrontAligning(); passView(actor); expect(actor.getSnapshot().matches('side.instructions')).toBe(true); actor.send({ type: 'START' }); passView(actor); expect(actor.getSnapshot().matches('processing')).toBe(true); actor.send({ type: 'PROCESS_SUCCESS', measurements: { chest: {} }, overallConfidence: 0.8 }); expect(actor.getSnapshot().matches('results')).toBe(true) })
  it('handles permission rejection', () => { const actor = actorAt([{ type: 'START' }, { type: 'CAMERA_DENIED' }]); expect(actor.getSnapshot().matches('permissionDenied')).toBe(true) })
  it('handles model load failure', () => { const actor = actorAt([{ type: 'START' }, { type: 'CAMERA_GRANTED' }, { type: 'MODEL_ERROR', error: 'offline' }]); expect(actor.getSnapshot().context.error).toBe('offline'); expect(actor.getSnapshot().matches('modelLoadFailed')).toBe(true) })
  it('prevents countdown until every hard gate passes', () => { const actor = reachFrontAligning(); actor.send({ type: 'SET_CAPTURE_MODE', mode: 'auto' }); actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: false }, hardReasonCodes: ['HEAD_OUT_OF_FRAME'], warningCodes: [] }); actor.send({ type: 'POSE_STABLE' }); expect(actor.getSnapshot().matches('front.aligning')).toBe(true) })
  it('keeps the XState countdown running through passing quality updates', () => {
    vi.useFakeTimers()
    try {
      const actor = reachFrontAligning()
      primeAutoCountdown(actor)
      expect(actor.getSnapshot().matches('front.countdown')).toBe(true)
      for (let elapsed = 0; elapsed < 3000; elapsed += 250) {
        vi.advanceTimersByTime(250)
        actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, hardReasonCodes: [], warningCodes: [] })
      }
      expect(actor.getSnapshot().matches('front.capturingBurst')).toBe(true)
      actor.stop()
    } finally { vi.useRealTimers() }
  })
  it('retakes front and side views', () => { const actor = reachFrontAligning(); actor.send({ type: 'CAPTURE_NOW' }); actor.send({ type: 'BURST_COMPLETE', frames, selectedFrames: frames }); actor.send({ type: 'RETAKE_VIEW' }); expect(actor.getSnapshot().context.selectedFrontFrames).toEqual([]); passView(actor); actor.send({ type: 'START' }); actor.send({ type: 'CAPTURE_NOW' }); actor.send({ type: 'BURST_COMPLETE', frames, selectedFrames: frames }); actor.send({ type: 'RETAKE_VIEW' }); expect(actor.getSnapshot().matches('side.aligning')).toBe(true) })
  it('supports targeted low-confidence retry', () => { const actor = reachFrontAligning(); passView(actor); actor.send({ type: 'START' }); passView(actor); actor.send({ type: 'PROCESS_LOW_CONFIDENCE', overallConfidence: 0.4 }); actor.send({ type: 'RETAKE_VIEW', view: 'front' }); expect(actor.getSnapshot().matches('front.aligning')).toBe(true) })
  it('allows only one additional burst per view', () => { const actor = reachFrontAligning(); passView(actor); actor.send({ type: 'START' }); passView(actor); actor.send({ type: 'PROCESS_LOW_CONFIDENCE', overallConfidence: 0.4 }); actor.send({ type: 'RETAKE_VIEW', view: 'front' }); passView(actor); actor.send({ type: 'START' }); passView(actor); actor.send({ type: 'PROCESS_LOW_CONFIDENCE', overallConfidence: 0.4 }); actor.send({ type: 'RETAKE_VIEW', view: 'front' }); expect(actor.getSnapshot().matches('lowConfidence')).toBe(true) })
  it('runs cleanup on cancellation', () => { const cleanup = vi.fn(); const actor = reachFrontAligning(); actor.send({ type: 'CANCEL', cleanup }); expect(cleanup).toHaveBeenCalledOnce(); expect(actor.getSnapshot().matches('cancelled')).toBe(true) })
  it('routes capture and processing failures to fatalError', () => { const actor = reachFrontAligning(); actor.send({ type: 'PROCESS_ERROR', error: 'capture failed' }); expect(actor.getSnapshot().matches('fatalError')).toBe(true); expect(actor.getSnapshot().context.error).toBe('capture failed') })
  it('captures the front manually from alignment and countdown', () => {
    const aligning = reachFrontAligning(); aligning.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, hardReasonCodes: [], warningCodes: [] }); aligning.send({ type: 'CAPTURE_NOW' }); expect(aligning.getSnapshot().matches('front.capturingBurst')).toBe(true)
    const countdown = reachFrontAligning(); primeAutoCountdown(countdown); expect(countdown.getSnapshot().matches('front.countdown')).toBe(true); countdown.send({ type: 'CAPTURE_NOW' }); expect(countdown.getSnapshot().matches('front.capturingBurst')).toBe(true)
  })
  it('allows manual capture with advisory warnings but not a hard blocker', () => {
    const actor = reachFrontAligning(); actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, hardReasonCodes: [], warningCodes: ['IMAGE_BLURRED'] }); actor.send({ type: 'CAPTURE_NOW' }); expect(actor.getSnapshot().matches('front.capturingBurst')).toBe(true)
    const blocked = reachFrontAligning(); blocked.send({ type: 'QUALITY_UPDATE', metrics: { passed: false }, hardReasonCodes: ['NO_PERSON'], warningCodes: [] }); blocked.send({ type: 'CAPTURE_NOW' }); expect(blocked.getSnapshot().matches('front.aligning')).toBe(true)
  })
  it('captures the side manually from alignment and countdown', () => {
    const aligning = reachFrontAligning(); passView(aligning); aligning.send({ type: 'START' }); aligning.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, hardReasonCodes: [], warningCodes: [] }); aligning.send({ type: 'CAPTURE_NOW' }); expect(aligning.getSnapshot().matches('side.capturingBurst')).toBe(true)
    const countdown = reachFrontAligning(); passView(countdown); countdown.send({ type: 'START' }); primeAutoCountdown(countdown); countdown.send({ type: 'CAPTURE_NOW' }); expect(countdown.getSnapshot().matches('side.capturingBurst')).toBe(true)
  })
  it('keeps advisory warnings and one transient hard failure inside countdown', () => {
    vi.useFakeTimers()
    try {
      const actor = reachFrontAligning(); primeAutoCountdown(actor)
      const deadline = actor.getSnapshot().context.countdownDeadline
      actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, hardReasonCodes: [], warningCodes: ['TOO_DARK'] }); expect(actor.getSnapshot().matches('front.countdown')).toBe(true); expect(actor.getSnapshot().context.countdownDeadline).toBe(deadline)
      actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: false }, hardReasonCodes: ['HEAD_OUT_OF_FRAME'], warningCodes: [], timestamp: performance.now() }); expect(actor.getSnapshot().matches('front.countdown')).toBe(true); expect(actor.getSnapshot().context.countdownDeadline).toBe(deadline)
    } finally { vi.useRealTimers() }
  })
  it('cancels auto countdown after three consecutive hard failures', () => {
    const actor = reachFrontAligning(); primeAutoCountdown(actor)
    actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: false }, hardReasonCodes: ['HEAD_OUT_OF_FRAME'], warningCodes: [], timestamp: 1300 }); actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: false }, hardReasonCodes: ['HEAD_OUT_OF_FRAME'], warningCodes: [], timestamp: 1550 })
    expect(actor.getSnapshot().matches('front.countdown')).toBe(true)
    actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: false }, hardReasonCodes: ['HEAD_OUT_OF_FRAME'], warningCodes: [], timestamp: 1800 })
    expect(actor.getSnapshot().matches('front.aligning')).toBe(true)
  })

  it('uses an 80-percent rolling readiness window and evicts stale samples', () => {
    let result = { qualityWindow: [], qualityReadiness: {} }
    for (let index = 0; index < 4; index += 1) result = updateRollingReadiness(result.qualityWindow, { hardReasonCodes: [], timestamp: index * 250 })
    result = updateRollingReadiness(result.qualityWindow, { hardReasonCodes: ['NO_PERSON'], timestamp: 1000 })
    expect(result.qualityReadiness).toMatchObject({ ready: true, passRatio: .8, sampleCount: 5 })
    result = updateRollingReadiness(result.qualityWindow, { hardReasonCodes: [], timestamp: 4000 })
    expect(result.qualityReadiness).toMatchObject({ ready: false, passRatio: 1, sampleCount: 1 })
  })
  it('exposes a stable ready state in manual mode', () => {
    const actor = reachFrontAligning(); for (let index = 0; index < 5; index += 1) actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, hardReasonCodes: [], warningCodes: [], timestamp: index * 250 }); actor.send({ type: 'POSE_STABLE' })
    expect(actor.getSnapshot().matches('front.ready')).toBe(true); actor.send({ type: 'CAPTURE_NOW' }); expect(actor.getSnapshot().matches('front.capturingBurst')).toBe(true)
  })
  it('enters ready, countdown, and capture exactly once under continued updates', () => {
    vi.useFakeTimers()
    try {
      const actor = reachFrontAligning(); let captureEntries = 0; let wasCapturing = false
      actor.subscribe((snapshot) => { const capturing = snapshot.matches('front.capturingBurst'); if (capturing && !wasCapturing) captureEntries += 1; wasCapturing = capturing })
      primeAutoCountdown(actor); expect(actor.getSnapshot().matches('front.countdown')).toBe(true)
      for (let index = 0; index < 12; index += 1) { vi.advanceTimersByTime(250); actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, hardReasonCodes: [], warningCodes: ['SUBJECT_MOVING'], timestamp: 1500 + index * 250 }) }
      expect(actor.getSnapshot().matches('front.capturingBurst')).toBe(true); expect(captureEntries).toBe(1)
    } finally { vi.useRealTimers() }
  })
})
