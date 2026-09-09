import { assign, setup } from 'xstate'
import { scanConfig } from './scanConfig'

export const initialCameraContext = () => ({
  heightMm: null, activeView: null, permissionStatus: 'idle', modelStatus: 'idle', qualityMetrics: null, qualityReasons: [], stableSince: null,
  qualityHardReasons: [], qualityWarnings: [], qualityWindow: [], qualityReadiness: { ready: false, passRatio: 0, sampleCount: 0 }, alignmentSnapshot: null,
  captureMode: 'manual', countdownDeadline: null, hardFailureSince: null, hardFailureCount: 0, captureError: null, captureWarnings: [],
  frontFrames: [], sideFrames: [], selectedFrontFrames: [], selectedSideFrames: [], frontCalibration: null, sideCalibration: null,
  measurements: {}, overallConfidence: null, warnings: [], error: null,
  captureAttempts: { front: 0, side: 0 },
})

const eventHardReasons = (event) => event.hardReasonCodes || event.metrics?.hardReasonCodes || (!event.metrics?.passed ? event.reasonCodes || event.metrics?.reasonCodes || [] : [])
const eventWarnings = (event) => event.warningCodes || event.metrics?.warningCodes || (event.metrics?.passed ? event.reasonCodes || event.metrics?.reasonCodes || [] : [])
const monotonicNow = () => globalThis.performance?.now?.() ?? Date.now()
export function updateRollingReadiness(history, event, now = event.timestamp ?? monotonicNow()) {
  const hardReasonCodes = eventHardReasons(event)
  const sample = { timestamp: now, passed: hardReasonCodes.length === 0, hardReasonCodes }
  const qualityWindow = [...history, sample].filter((item) => now - item.timestamp <= scanConfig.pose.readinessWindowMs)
  const passRatio = qualityWindow.length ? qualityWindow.filter((item) => item.passed).length / qualityWindow.length : 0
  return { qualityWindow, qualityReadiness: { ready: qualityWindow.length >= scanConfig.pose.readinessMinimumSamples && passRatio >= scanConfig.pose.readinessPassRatioMin, passRatio, sampleCount: qualityWindow.length } }
}
const qualityContext = (event) => {
  const hardReasonCodes = eventHardReasons(event); const warningCodes = eventWarnings(event)
  return { qualityMetrics: { ...event.metrics, passed: hardReasonCodes.length === 0, hardReasonCodes, warningCodes, reasonCodes: [...hardReasonCodes, ...warningCodes] }, qualityReasons: [...hardReasonCodes, ...warningCodes], qualityHardReasons: hardReasonCodes, qualityWarnings: warningCodes }
}
const storeQuality = assign(({ event }) => qualityContext(event))
const storeQualityAndReadiness = assign(({ context, event }) => ({ ...updateRollingReadiness(context.qualityWindow, event), ...qualityContext(event) }))
const storeBurst = assign(({ context, event }) => context.activeView === 'front'
  ? { frontFrames: event.frames || [], selectedFrontFrames: event.selectedFrames || [], captureAttempts: { ...context.captureAttempts, front: context.captureAttempts.front + 1 }, captureWarnings: event.warningCodes || [], captureError: null }
  : { sideFrames: event.frames || [], selectedSideFrames: event.selectedFrames || [], captureAttempts: { ...context.captureAttempts, side: context.captureAttempts.side + 1 }, captureWarnings: event.warningCodes || [], captureError: null })

const countdownState = {
  entry: 'beginCountdown',
  after: { 3000: 'capturingBurst' },
  on: {
    CAPTURE_NOW: { target: 'capturingBurst', actions: 'clearCaptureMessage' },
    QUALITY_UPDATE: [
      { guard: 'persistentHardFailure', target: 'aligning', actions: [storeQualityAndReadiness, 'resetCountdown'] },
      { guard: 'eventHasHardFailure', actions: [storeQualityAndReadiness, 'recordHardFailure'] },
      { actions: [storeQualityAndReadiness, 'clearHardFailure'] },
    ],
    POSE_UNSTABLE: {},
    COUNTDOWN_COMPLETE: 'capturingBurst',
    SET_CAPTURE_MODE: [{ guard: 'switchingToManual', target: 'aligning', actions: ['setCaptureMode', 'resetCountdown'] }, { actions: 'setCaptureMode' }],
  },
}

const readyState = {
  always: { guard: 'autoCaptureMode', target: 'countdown' },
  on: {
    CAPTURE_NOW: { target: 'capturingBurst', actions: 'clearCaptureMessage' },
    QUALITY_UPDATE: [
      { guard: 'eventHasHardFailure', target: 'aligning', actions: storeQualityAndReadiness },
      { actions: storeQualityAndReadiness },
    ],
    POSE_UNSTABLE: 'aligning',
    SET_CAPTURE_MODE: [{ guard: 'switchingToAuto', target: 'countdown', actions: 'setCaptureMode' }, { actions: 'setCaptureMode' }],
  },
}

const machineDefinition = {
  id: 'cameraScan', initial: 'idle', context: initialCameraContext,
  on: {
    CANCEL: { target: '.cancelled', actions: 'cleanup' },
    RETURN_TO_MANUAL: { target: '.cancelled', actions: 'cleanup' },
    CAMERA_DENIED: { target: '.permissionDenied', actions: assign({ permissionStatus: 'denied' }) },
    PROCESS_ERROR: { target: '.fatalError', actions: assign(({ event }) => ({ error: event.error })) },
    SET_CAPTURE_MODE: { actions: 'setCaptureMode' },
  },
  states: {
    idle: { on: { START: { target: 'requestingPermission' } } },
    requestingPermission: { entry: assign({ permissionStatus: 'requesting' }), on: { CAMERA_GRANTED: { target: 'loadingModels', actions: assign({ permissionStatus: 'granted' }) }, CAMERA_DENIED: { target: 'permissionDenied', actions: assign({ permissionStatus: 'denied' }) } } },
    permissionDenied: { on: { START: 'requestingPermission' } },
    loadingModels: { entry: assign({ modelStatus: 'loading' }), on: { MODELS_READY: { target: 'heightEntry', actions: assign({ modelStatus: 'ready' }) }, MODEL_ERROR: { target: 'modelLoadFailed', actions: assign(({ event }) => ({ modelStatus: 'failed', error: event.error })) } } },
    modelLoadFailed: { on: { START: 'loadingModels' } },
    heightEntry: { on: { SET_HEIGHT_MM: { guard: 'validHeight', target: 'front.instructions', actions: assign(({ event }) => ({ heightMm: event.heightMm, activeView: 'front' })) } } },
    front: {
      initial: 'instructions', states: {
        instructions: { on: { START: 'aligning' } },
        aligning: { entry: 'resetAlignment', on: { QUALITY_UPDATE: { actions: storeQualityAndReadiness }, POSE_STABLE: { guard: 'qualityReady', target: 'ready' }, CAPTURE_NOW: { guard: 'manualQualityReady', target: 'capturingBurst', actions: 'clearCaptureMessage' } } },
        ready: readyState,
        countdown: countdownState,
        capturingBurst: { on: { BURST_COMPLETE: { target: 'review', actions: storeBurst }, BURST_REJECTED: { target: 'aligning', actions: 'storeCaptureRejection' } } },
        review: { on: { ACCEPT_CAPTURE: { guard: 'frontReady', target: '#cameraScan.side.instructions', actions: assign({ activeView: 'side' }) }, RETAKE_VIEW: { target: 'aligning', actions: 'clearFront' } } },
      },
    },
    side: {
      initial: 'instructions', states: {
        instructions: { on: { START: 'aligning' } },
        aligning: { entry: 'resetAlignment', on: { QUALITY_UPDATE: { actions: storeQualityAndReadiness }, POSE_STABLE: { guard: 'qualityReady', target: 'ready' }, CAPTURE_NOW: { guard: 'manualQualityReady', target: 'capturingBurst', actions: 'clearCaptureMessage' } } },
        ready: readyState,
        countdown: countdownState,
        capturingBurst: { on: { BURST_COMPLETE: { target: 'review', actions: storeBurst }, BURST_REJECTED: { target: 'aligning', actions: 'storeCaptureRejection' } } },
        review: { on: { ACCEPT_CAPTURE: { guard: 'bothViewsReady', target: '#cameraScan.processing' }, RETAKE_VIEW: { target: 'aligning', actions: 'clearSide' } } },
      },
    },
    processing: { on: {
      PROCESS_SUCCESS: { target: 'results', actions: 'storeResults' },
      PROCESS_LOW_CONFIDENCE: { target: 'lowConfidence', actions: 'storeResults' },
      PROCESS_ERROR: { target: 'fatalError', actions: assign(({ event }) => ({ error: event.error })) },
    } },
    lowConfidence: { on: {
      RETAKE_VIEW: [{ guard: 'canRetryFront', target: 'front.aligning', actions: ['clearFront', assign({ activeView: 'front' })] }, { guard: 'canRetrySide', target: 'side.aligning', actions: ['clearSide', assign({ activeView: 'side' })] }],
    } },
    results: {},
    cancelled: { on: { RESTART: { target: 'idle', actions: 'reset' } } },
    fatalError: { on: { RESTART: { target: 'idle', actions: 'reset' } } },
  },
}

export const cameraMachine = setup({
  guards: {
    validHeight: ({ event }) => Number.isInteger(event.heightMm) && event.heightMm >= 1000 && event.heightMm <= 2500,
    qualityReady: ({ context }) => context.qualityReadiness.ready && context.qualityHardReasons.length === 0,
    autoCaptureMode: ({ context }) => context.captureMode === 'auto',
    manualQualityReady: ({ context }) => Boolean(context.qualityMetrics) && context.qualityHardReasons.length === 0,
    eventHasHardFailure: ({ event }) => eventHardReasons(event).length > 0,
    persistentHardFailure: ({ context, event }) => eventHardReasons(event).length > 0 && context.hardFailureCount >= scanConfig.pose.countdownHardFailureSamples - 1,
    switchingToManual: ({ event }) => event.mode === 'manual',
    switchingToAuto: ({ event }) => event.mode === 'auto',
    frontReady: ({ context }) => context.selectedFrontFrames.length >= 3,
    bothViewsReady: ({ context }) => context.selectedFrontFrames.length >= 3 && context.selectedSideFrames.length >= 3,
    canRetryFront: ({ context, event }) => event.view === 'front' && context.captureAttempts.front < 2,
    canRetrySide: ({ context, event }) => event.view === 'side' && context.captureAttempts.side < 2,
  },
  actions: {
    cleanup: ({ event }) => event.cleanup?.(),
    setCaptureMode: assign(({ event }) => ({ captureMode: event.mode === 'auto' ? 'auto' : 'manual' })),
    beginCountdown: assign(({ context }) => ({ countdownDeadline: monotonicNow() + 3000, stableSince: monotonicNow(), alignmentSnapshot: { qualityMetrics: context.qualityMetrics, qualityReadiness: context.qualityReadiness }, hardFailureSince: null, hardFailureCount: 0 })),
    recordHardFailure: assign(({ context, event }) => ({ hardFailureSince: context.hardFailureSince ?? event.timestamp ?? monotonicNow(), hardFailureCount: context.hardFailureCount + 1 })),
    clearHardFailure: assign({ hardFailureSince: null, hardFailureCount: 0 }),
    resetCountdown: assign({ countdownDeadline: null, stableSince: null, hardFailureSince: null, hardFailureCount: 0 }),
    resetAlignment: assign({ countdownDeadline: null, stableSince: null, hardFailureSince: null, hardFailureCount: 0, qualityWindow: [], qualityReadiness: { ready: false, passRatio: 0, sampleCount: 0 }, alignmentSnapshot: null }),
    clearCaptureMessage: assign({ captureError: null, captureWarnings: [] }),
    storeCaptureRejection: assign(({ event }) => ({ captureError: event.error || 'This capture could not be used.', captureWarnings: event.warningCodes || [], countdownDeadline: null, hardFailureSince: null, hardFailureCount: 0 })),
    reset: assign(() => initialCameraContext()),
    clearFront: assign({ frontFrames: [], selectedFrontFrames: [], frontCalibration: null }),
    clearSide: assign({ sideFrames: [], selectedSideFrames: [], sideCalibration: null }),
    storeResults: assign(({ event }) => ({ measurements: event.measurements || {}, overallConfidence: event.overallConfidence ?? 0, warnings: event.warnings || [], frontCalibration: event.frontCalibration || null, sideCalibration: event.sideCalibration || null })),
  },
}).createMachine(machineDefinition)
