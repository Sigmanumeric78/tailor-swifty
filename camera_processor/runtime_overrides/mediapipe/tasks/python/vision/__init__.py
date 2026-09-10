# Copyright 2022 The MediaPipe Authors.
# Licensed under the Apache License, Version 2.0.
"""MediaPipe Pose Landmarker API subset used by the camera processor."""

import mediapipe.tasks.python.vision.core
import mediapipe.tasks.python.vision.pose_landmarker

PoseLandmarker = pose_landmarker.PoseLandmarker
PoseLandmarkerOptions = pose_landmarker.PoseLandmarkerOptions
PoseLandmarkerResult = pose_landmarker.PoseLandmarkerResult
PoseLandmarksConnections = pose_landmarker.PoseLandmarksConnections
RunningMode = core.vision_task_running_mode.VisionTaskRunningMode

del core
del pose_landmarker
del mediapipe
