import { createActor } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import { cameraMachine } from '../cameraMachine'

const frames = [1, 2, 3].map((id) => ({ id }))
const actorAt = (events = []) => { const actor = createActor(cameraMachine).start(); events.forEach((event) => actor.send(event)); return actor }
const reachFrontAligning = () => actorAt([{ type: 'START' }, { type: 'CAMERA_GRANTED' }, { type: 'MODELS_READY' }, { type: 'SET_HEIGHT_MM', heightMm: 1800 }, { type: 'START' }])
const passView = (actor) => { actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, reasonCodes: [] }); actor.send({ type: 'POSE_STABLE' }); actor.send({ type: 'COUNTDOWN_COMPLETE' }); actor.send({ type: 'BURST_COMPLETE', frames, selectedFrames: frames }); actor.send({ type: 'ACCEPT_CAPTURE' }) }

describe('camera machine', () => {
  it('follows the happy path without hardware', () => { const actor = reachFrontAligning(); passView(actor); expect(actor.getSnapshot().matches('side.instructions')).toBe(true); actor.send({ type: 'START' }); passView(actor); expect(actor.getSnapshot().matches('processing')).toBe(true); actor.send({ type: 'PROCESS_SUCCESS', measurements: { chest: {} }, overallConfidence: 0.8 }); expect(actor.getSnapshot().matches('results')).toBe(true) })
  it('handles permission rejection', () => { const actor = actorAt([{ type: 'START' }, { type: 'CAMERA_DENIED' }]); expect(actor.getSnapshot().matches('permissionDenied')).toBe(true) })
  it('handles model load failure', () => { const actor = actorAt([{ type: 'START' }, { type: 'CAMERA_GRANTED' }, { type: 'MODEL_ERROR', error: 'offline' }]); expect(actor.getSnapshot().context.error).toBe('offline'); expect(actor.getSnapshot().matches('modelLoadFailed')).toBe(true) })
  it('prevents countdown until every gate passes', () => { const actor = reachFrontAligning(); actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: false }, reasonCodes: ['TOO_DARK'] }); actor.send({ type: 'POSE_STABLE' }); expect(actor.getSnapshot().matches('front.aligning')).toBe(true) })
  it('returns to alignment when quality regresses', () => { const actor = reachFrontAligning(); actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, reasonCodes: [] }); actor.send({ type: 'POSE_STABLE' }); actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: false }, reasonCodes: ['SUBJECT_MOVING'] }); expect(actor.getSnapshot().matches('front.aligning')).toBe(true) })
  it('keeps the XState countdown running through passing quality updates', () => {
    vi.useFakeTimers()
    try {
      const actor = reachFrontAligning()
      actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, reasonCodes: [] })
      actor.send({ type: 'POSE_STABLE' })
      expect(actor.getSnapshot().matches('front.countdown')).toBe(true)
      for (let elapsed = 0; elapsed < 3000; elapsed += 250) {
        vi.advanceTimersByTime(250)
        actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, reasonCodes: [] })
      }
      expect(actor.getSnapshot().matches('front.capturingBurst')).toBe(true)
      actor.stop()
    } finally { vi.useRealTimers() }
  })
  it('retakes front and side views', () => { const actor = reachFrontAligning(); actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, reasonCodes: [] }); actor.send({ type: 'POSE_STABLE' }); actor.send({ type: 'COUNTDOWN_COMPLETE' }); actor.send({ type: 'BURST_COMPLETE', frames, selectedFrames: frames }); actor.send({ type: 'RETAKE_VIEW' }); expect(actor.getSnapshot().context.selectedFrontFrames).toEqual([]); passView(actor); actor.send({ type: 'START' }); actor.send({ type: 'QUALITY_UPDATE', metrics: { passed: true }, reasonCodes: [] }); actor.send({ type: 'POSE_STABLE' }); actor.send({ type: 'COUNTDOWN_COMPLETE' }); actor.send({ type: 'BURST_COMPLETE', frames, selectedFrames: frames }); actor.send({ type: 'RETAKE_VIEW' }); expect(actor.getSnapshot().matches('side.aligning')).toBe(true) })
  it('supports targeted low-confidence retry', () => { const actor = reachFrontAligning(); passView(actor); actor.send({ type: 'START' }); passView(actor); actor.send({ type: 'PROCESS_LOW_CONFIDENCE', overallConfidence: 0.4 }); actor.send({ type: 'RETAKE_VIEW', view: 'front' }); expect(actor.getSnapshot().matches('front.aligning')).toBe(true) })
  it('allows only one additional burst per view', () => { const actor = reachFrontAligning(); passView(actor); actor.send({ type: 'START' }); passView(actor); actor.send({ type: 'PROCESS_LOW_CONFIDENCE', overallConfidence: 0.4 }); actor.send({ type: 'RETAKE_VIEW', view: 'front' }); passView(actor); actor.send({ type: 'START' }); passView(actor); actor.send({ type: 'PROCESS_LOW_CONFIDENCE', overallConfidence: 0.4 }); actor.send({ type: 'RETAKE_VIEW', view: 'front' }); expect(actor.getSnapshot().matches('lowConfidence')).toBe(true) })
  it('runs cleanup on cancellation', () => { const cleanup = vi.fn(); const actor = reachFrontAligning(); actor.send({ type: 'CANCEL', cleanup }); expect(cleanup).toHaveBeenCalledOnce(); expect(actor.getSnapshot().matches('cancelled')).toBe(true) })
  it('routes capture and processing failures to fatalError', () => { const actor = reachFrontAligning(); actor.send({ type: 'PROCESS_ERROR', error: 'capture failed' }); expect(actor.getSnapshot().matches('fatalError')).toBe(true); expect(actor.getSnapshot().context.error).toBe('capture failed') })
})
