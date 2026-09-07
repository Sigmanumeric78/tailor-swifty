export const ReasonCode = Object.freeze(Object.fromEntries([
  'NO_PERSON', 'MULTIPLE_PEOPLE', 'HEAD_OUT_OF_FRAME', 'FEET_OUT_OF_FRAME', 'BODY_TOO_SMALL', 'BODY_TOO_LARGE',
  'MOVE_LEFT', 'MOVE_RIGHT', 'TOO_DARK', 'TOO_BRIGHT', 'LOW_CONTRAST', 'IMAGE_BLURRED', 'SUBJECT_MOVING',
  'LANDMARKS_UNCERTAIN', 'NOT_FRONT_FACING', 'NOT_SIDE_FACING', 'ARMS_TOUCHING_TORSO', 'SEGMENTATION_UNSTABLE',
  'SILHOUETTE_DISAGREEMENT', 'CALIBRATION_FAILED', 'REPEAT_DISAGREEMENT', 'MODEL_UNAVAILABLE',
].map((code) => [code, code])))

export const reasonInstructions = Object.freeze({
  NO_PERSON: 'Step fully into the guide.', MULTIPLE_PEOPLE: 'Ask everyone else to leave the frame.', HEAD_OUT_OF_FRAME: 'Move back until your full head is visible.',
  FEET_OUT_OF_FRAME: 'Move back until both feet are visible.', BODY_TOO_SMALL: 'Move closer without cropping your head or feet.', BODY_TOO_LARGE: 'Move farther from the camera.',
  MOVE_LEFT: 'Move slightly left.', MOVE_RIGHT: 'Move slightly right.', TOO_DARK: 'Add even light in front of you.', TOO_BRIGHT: 'Reduce bright or back lighting.',
  LOW_CONTRAST: 'Use a plain background that contrasts with your clothes.', IMAGE_BLURRED: 'Clean the lens and hold the phone steady.', SUBJECT_MOVING: 'Hold your pose without moving.',
  LANDMARKS_UNCERTAIN: 'Make every joint visible and unobstructed.', NOT_FRONT_FACING: 'Face the camera squarely.', NOT_SIDE_FACING: 'Turn approximately 90 degrees to the camera.',
  ARMS_TOUCHING_TORSO: 'Move your arms slightly away from your torso.', SEGMENTATION_UNSTABLE: 'Use a plain background and hold still.',
  SILHOUETTE_DISAGREEMENT: 'Retake this view against a clearer background.', CALIBRATION_FAILED: 'Retake with your full head and feet visible.',
  REPEAT_DISAGREEMENT: 'Retake this view and hold the same neutral posture.', MODEL_UNAVAILABLE: 'Retry model loading or continue with manual measurements.',
})
