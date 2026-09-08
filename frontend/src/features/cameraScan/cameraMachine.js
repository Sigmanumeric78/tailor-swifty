import { assign, setup } from 'xstate'

export const initialCameraContext = () => ({
  heightMm: null, activeView: null, permissionStatus: 'idle', modelStatus: 'idle', qualityMetrics: null, qualityReasons: [], stableSince: null,
  frontFrames: [], sideFrames: [], selectedFrontFrames: [], selectedSideFrames: [], frontCalibration: null, sideCalibration: null,
  measurements: {}, overallConfidence: null, warnings: [], error: null,
  captureAttempts: { front: 0, side: 0 },
})

const storeQuality = assign(({ event }) => ({ qualityMetrics: event.metrics, qualityReasons: event.reasonCodes || event.metrics?.reasonCodes || [] }))
const storeBurst = assign(({ context, event }) => context.activeView === 'front'
  ? { frontFrames: event.frames || [], selectedFrontFrames: event.selectedFrames || [], captureAttempts: { ...context.captureAttempts, front: context.captureAttempts.front + 1 } }
  : { sideFrames: event.frames || [], selectedSideFrames: event.selectedFrames || [], captureAttempts: { ...context.captureAttempts, side: context.captureAttempts.side + 1 } })

const machineDefinition = {
  id: 'cameraScan', initial: 'idle', context: initialCameraContext,
  on: {
    CANCEL: { target: '.cancelled', actions: 'cleanup' },
    RETURN_TO_MANUAL: { target: '.cancelled', actions: 'cleanup' },
    CAMERA_DENIED: { target: '.permissionDenied', actions: assign({ permissionStatus: 'denied' }) },
    PROCESS_ERROR: { target: '.fatalError', actions: assign(({ event }) => ({ error: event.error })) },
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
        aligning: { on: { QUALITY_UPDATE: { actions: storeQuality }, POSE_STABLE: { guard: 'qualityPassed', target: 'countdown', actions: assign({ stableSince: () => Date.now() }) } } },
        countdown: { after: { 3000: 'capturingBurst' }, on: { QUALITY_UPDATE: [{ guard: 'eventQualityFailed', target: 'aligning', actions: storeQuality }, { actions: storeQuality }], POSE_UNSTABLE: 'aligning', COUNTDOWN_COMPLETE: 'capturingBurst' } },
        capturingBurst: { on: { BURST_COMPLETE: { target: 'review', actions: storeBurst } } },
        review: { on: { ACCEPT_CAPTURE: { guard: 'frontReady', target: '#cameraScan.side.instructions', actions: assign({ activeView: 'side' }) }, RETAKE_VIEW: { target: 'aligning', actions: 'clearFront' } } },
      },
    },
    side: {
      initial: 'instructions', states: {
        instructions: { on: { START: 'aligning' } },
        aligning: { on: { QUALITY_UPDATE: { actions: storeQuality }, POSE_STABLE: { guard: 'qualityPassed', target: 'countdown', actions: assign({ stableSince: () => Date.now() }) } } },
        countdown: { after: { 3000: 'capturingBurst' }, on: { QUALITY_UPDATE: [{ guard: 'eventQualityFailed', target: 'aligning', actions: storeQuality }, { actions: storeQuality }], POSE_UNSTABLE: 'aligning', COUNTDOWN_COMPLETE: 'capturingBurst' } },
        capturingBurst: { on: { BURST_COMPLETE: { target: 'review', actions: storeBurst } } },
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
    qualityPassed: ({ context }) => Boolean(context.qualityMetrics?.passed) && context.qualityReasons.length === 0,
    eventQualityFailed: ({ event }) => !event.metrics?.passed || Boolean(event.reasonCodes?.length),
    frontReady: ({ context }) => context.selectedFrontFrames.length >= 3,
    bothViewsReady: ({ context }) => context.selectedFrontFrames.length >= 3 && context.selectedSideFrames.length >= 3,
    canRetryFront: ({ context, event }) => event.view === 'front' && context.captureAttempts.front < 2,
    canRetrySide: ({ context, event }) => event.view === 'side' && context.captureAttempts.side < 2,
  },
  actions: {
    cleanup: ({ event }) => event.cleanup?.(),
    reset: assign(() => initialCameraContext()),
    clearFront: assign({ frontFrames: [], selectedFrontFrames: [], frontCalibration: null }),
    clearSide: assign({ sideFrames: [], selectedSideFrames: [], sideCalibration: null }),
    storeResults: assign(({ event }) => ({ measurements: event.measurements || {}, overallConfidence: event.overallConfidence ?? 0, warnings: event.warnings || [], frontCalibration: event.frontCalibration || null, sideCalibration: event.sideCalibration || null })),
  },
}).createMachine(machineDefinition)
