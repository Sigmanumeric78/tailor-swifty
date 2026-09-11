"""In-memory MediaPipe/OpenCV camera observation extraction."""

from __future__ import annotations

import hashlib
import math
import os
import time
from pathlib import Path
from typing import Any

from image_headers import image_dimensions


MODEL_ID = "mediapipe-pose-landmarker-full-float16-v1"
MODEL_RUNTIME = "mediapipe-0.10.21"
OPENCV_RUNTIME = "opencv-4.10.0.84"
MODEL_SHA256 = "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1"
MAX_COMPRESSED_IMAGE_BYTES = 2_500_000
MAX_IMAGE_PIXELS = 6_000_000
MAX_LONG_EDGE = 1_600
LANDMARK_NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow",
    "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index",
    "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle",
    "right_ankle", "left_heel", "right_heel", "left_foot_index", "right_foot_index",
]


class ProcessingError(ValueError):
    def __init__(self, status: int, code: str, correction: str):
        super().__init__(code)
        self.status = status
        self.code = code
        self.correction = correction


_landmarker = None
_model_initialization_ms: float | None = None


def validate_image_limits(image_bytes: bytes, mime_type: str) -> tuple[int, int]:
    if len(image_bytes) > MAX_COMPRESSED_IMAGE_BYTES:
        raise ProcessingError(413, "IMAGE_BYTES_EXCEEDED", "Compress the photograph below 2.5 MB and try again.")
    try:
        width, height = image_dimensions(image_bytes, mime_type)
    except ValueError as exc:
        code = str(exc) if str(exc) in {"INVALID_IMAGE", "UNSUPPORTED_IMAGE_FORMAT"} else "INVALID_IMAGE"
        raise ProcessingError(415 if code == "UNSUPPORTED_IMAGE_FORMAT" else 422, code, "Use a valid JPEG or WebP photograph.") from exc
    if width <= 0 or height <= 0:
        raise ProcessingError(422, "INVALID_IMAGE", "Use a valid JPEG or WebP photograph.")
    if width * height > MAX_IMAGE_PIXELS or max(width, height) > MAX_LONG_EDGE:
        raise ProcessingError(413, "IMAGE_DIMENSIONS_EXCEEDED", "Resize the photograph to at most 1600 pixels on its longest edge.")
    return width, height


def _verify_model(model_path: Path) -> None:
    if not model_path.is_file():
        raise ProcessingError(503, "MODEL_UNAVAILABLE", "The processing model is unavailable.")
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    if digest != MODEL_SHA256:
        raise ProcessingError(503, "MODEL_INTEGRITY_FAILED", "The processing model failed its integrity check.")


def get_landmarker():
    global _landmarker, _model_initialization_ms
    if _landmarker is not None:
        return _landmarker
    started = time.perf_counter()
    model_path = Path(os.environ.get("POSE_MODEL_PATH", Path(__file__).parent / "models" / "pose_landmarker_full.task"))
    _verify_model(model_path)
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision

    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.IMAGE,
        num_poses=2,
        output_segmentation_masks=True,
    )
    _landmarker = vision.PoseLandmarker.create_from_options(options)
    _model_initialization_ms = (time.perf_counter() - started) * 1000
    return _landmarker


def _point(point: Any) -> dict[str, float]:
    return {
        "x": float(point.x),
        "y": float(point.y),
        "visibility": float(getattr(point, "visibility", 0.0) or 0.0),
        "presence": float(getattr(point, "presence", 0.0) or 0.0),
    }


def _usable(point: dict[str, float] | None) -> bool:
    return bool(point and point["visibility"] >= 0.55 and point["presence"] >= 0.50)


def _score(point: dict[str, float] | None) -> float:
    return min(point.get("visibility", 0), point.get("presence", 0)) if point else 0.0


def _required_landmarks(landmarks: dict[str, dict[str, float]], view: str) -> list[str]:
    head = max(["nose", "left_eye", "right_eye", "left_ear", "right_ear"], key=lambda name: _score(landmarks.get(name)))
    if view == "FRONT":
        shoulder = max(["left_shoulder", "right_shoulder"], key=lambda name: _score(landmarks.get(name)))
        hip = max(["left_hip", "right_hip"], key=lambda name: _score(landmarks.get(name)))
        return [head, shoulder, hip]
    chains = []
    for side in ("left", "right"):
        names = [f"{side}_shoulder", f"{side}_hip"]
        chains.append((all(_usable(landmarks.get(name)) for name in names), sum(_score(landmarks.get(name)) for name in names), side, names))
    _, _, near_side, names = max(chains)
    near_head = max(["nose", f"{near_side}_eye", f"{near_side}_ear"], key=lambda name: _score(landmarks.get(name)))
    return [near_head, *names]


def _distance_to_component(labels, component: int, x: int, y: int, cv2, np) -> float:
    component_mask = (labels == component).astype("uint8")
    if 0 <= y < labels.shape[0] and 0 <= x < labels.shape[1] and component_mask[y, x]:
        return 0.0
    points = cv2.findNonZero(component_mask)
    if points is None:
        return math.inf
    deltas = points[:, 0, :].astype("float32") - np.array([x, y], dtype="float32")
    return float(np.sqrt((deltas * deltas).sum(axis=1)).min())


def _clean_person_mask(mask, landmarks: dict[str, dict[str, float]], cv2, np):
    height, width = mask.shape
    binary = (mask >= 0.55).astype("uint8")
    silhouette_height = max(1, int(np.count_nonzero(binary.any(axis=1))))
    kernel_size = max(3, min(15, int(round(silhouette_height * 0.008))))
    if kernel_size % 2 == 0:
        kernel_size += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    anchors = []
    for names in (("left_shoulder", "right_shoulder"), ("left_hip", "right_hip")):
        points = [landmarks.get(name) for name in names]
        if all(point is not None for point in points):
            anchors.append((round(sum(point["x"] for point in points) * width / 2), round(sum(point["y"] for point in points) * height / 2)))
    if len(anchors) != 2:
        raise ProcessingError(422, "LANDMARKS_UNCERTAIN", "Keep shoulders, hips, and the full body clearly visible.")
    candidates = []
    for component in range(1, count):
        distances = [_distance_to_component(labels, component, x, y, cv2, np) for x, y in anchors]
        proximity = max(distances) / max(1, silhouette_height)
        if proximity <= 0.08:
            candidates.append((proximity, -int(stats[component, cv2.CC_STAT_AREA]), component))
    if not candidates:
        raise ProcessingError(422, "SEGMENTATION_MISSING", "Use a plain background and keep one full-body person visible.")
    selected = min(candidates)[2]
    cleaned = (labels == selected).astype("uint8")
    contours, _ = cv2.findContours(cleaned, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ProcessingError(422, "SEGMENTATION_MISSING", "Use a plain background and keep one full-body person visible.")
    filled = np.zeros_like(cleaned)
    cv2.drawContours(filled, contours, -1, 1, thickness=cv2.FILLED)
    return filled


def _scan_width(mask, y: float, center_x: float, np) -> tuple[float | None, int | None]:
    height, width = mask.shape
    rows = []
    for row in range(max(0, round(y) - 3), min(height, round(y) + 4)):
        xs = np.flatnonzero(mask[row])
        if not xs.size:
            continue
        breaks = np.where(np.diff(xs) > 1)[0]
        starts = np.r_[0, breaks + 1]
        ends = np.r_[breaks, len(xs) - 1]
        intervals = [(int(xs[start]), int(xs[end])) for start, end in zip(starts, ends)]
        containing = [item for item in intervals if item[0] <= center_x <= item[1]]
        if containing:
            left, right = max(containing, key=lambda item: item[1] - item[0])
            rows.append((right - left + 1, row))
    if not rows:
        return None, None
    rows.sort()
    return rows[len(rows) // 2]


def _scan_band(mask, start: float, end: float, center_x: float, prefer_widest: bool, np) -> tuple[float | None, int | None]:
    rows = []
    step = max(1, round((end - start) / 8))
    for y in range(round(start), round(end) + 1, step):
        measured = _scan_width(mask, y, center_x, np)
        if measured[0] is not None:
            rows.append(measured)
    if not rows:
        return None, None
    return max(rows, key=lambda item: item[0]) if prefer_widest else min(rows, key=lambda item: item[0])


def _quality(image, bounds: tuple[int, int, int, int], cv2, np) -> tuple[dict[str, float], list[str], list[str]]:
    x, y, width, height = bounds
    pad_x, pad_y = round(width * 0.08), round(height * 0.08)
    roi = image[max(0, y - pad_y):min(image.shape[0], y + height + pad_y), max(0, x - pad_x):min(image.shape[1], x + width + pad_x)]
    gray = cv2.cvtColor(roi, cv2.COLOR_RGB2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    mean = float(gray.mean())
    contrast = float(gray.std())
    dark = float(np.mean(gray < 20))
    highlight = float(np.mean(gray > 245))
    hard, warnings = [], []
    if sharpness < 20:
        hard.append("SEVERE_BLUR")
    elif sharpness < 80:
        warnings.append("IMAGE_BLURRED")
    if mean < 22:
        hard.append("SEVERE_UNDEREXPOSURE")
    elif mean < 45:
        warnings.append("TOO_DARK")
    if mean > 238:
        hard.append("SEVERE_OVEREXPOSURE")
    elif mean > 215:
        warnings.append("TOO_BRIGHT")
    if contrast < 20:
        warnings.append("LOW_CONTRAST")
    score = max(0.0, min(1.0, min(sharpness / 120, contrast / 45, 1 - dark, 1 - highlight)))
    return {"sharpness": round(sharpness, 3), "mean_luminance": round(mean, 3), "contrast": round(contrast, 3), "dark_fraction": round(dark, 4), "highlight_fraction": round(highlight, 4), "score": round(score, 4)}, hard, warnings


def process_image(image_bytes: bytes, mime_type: str, view: str, verified_height_mm: int, *, landmarker=None) -> tuple[dict[str, Any], dict[str, float]]:
    total_started = time.perf_counter()
    width, height = validate_image_limits(image_bytes, mime_type)
    import cv2
    import mediapipe as mp
    import numpy as np

    image = None
    result = None
    mask = None
    cleaned = None
    try:
        decode_started = time.perf_counter()
        encoded = np.frombuffer(image_bytes, dtype=np.uint8)
        bgr = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if bgr is None or bgr.shape[1] != width or bgr.shape[0] != height:
            raise ProcessingError(422, "INVALID_IMAGE", "Use a valid JPEG or WebP photograph.")
        image = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        decode_ms = (time.perf_counter() - decode_started) * 1000
        pose_started = time.perf_counter()
        model = landmarker or get_landmarker()
        result = model.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=image))
        pose_ms = (time.perf_counter() - pose_started) * 1000
        poses = list(result.pose_landmarks or [])
        if not poses:
            raise ProcessingError(422, "NO_PERSON", "Keep one full-body person visible against a plain background.")
        if len(poses) > 1:
            raise ProcessingError(422, "MULTIPLE_PEOPLE", "Keep every other person out of the frame.")
        landmarks = {name: _point(point) for name, point in zip(LANDMARK_NAMES, poses[0])}
        required_landmarks = _required_landmarks(landmarks, view)
        if not all(_usable(landmarks.get(name)) for name in required_landmarks):
            raise ProcessingError(422, "LANDMARKS_UNCERTAIN", "Keep the head, shoulders, hips, and full body clearly visible.")
        masks = list(result.segmentation_masks or [])
        if not masks:
            raise ProcessingError(422, "SEGMENTATION_MISSING", "Use a plain contrasting background and keep the full body visible.")
        mask = np.asarray(masks[0].numpy_view(), dtype=np.float32)
        if mask.ndim == 3:
            mask = mask[:, :, 0]
        if mask.shape != (height, width):
            mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_LINEAR)
        cleaned = _clean_person_mask(mask, landmarks, cv2, np)
        ys, xs = np.nonzero(cleaned)
        if not len(xs):
            raise ProcessingError(422, "SEGMENTATION_MISSING", "Use a plain contrasting background and keep the full body visible.")
        min_x, max_x, min_y, max_y = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
        silhouette_height = max_y - min_y + 1
        occupancy = silhouette_height / height
        hard, warnings = [], []
        if not any(_usable(landmarks.get(name)) for name in ("left_knee", "right_knee")):
            warnings.append("KNEE_VISIBILITY_LOW")
        if min_y <= 1:
            hard.append("HEAD_OUT_OF_FRAME")
        if max_y >= height - 2:
            hard.append("FEET_OUT_OF_FRAME")
        if occupancy < 0.50:
            hard.append("BODY_TOO_SMALL")
        elif occupancy < 0.65:
            warnings.append("BODY_TOO_SMALL")
        if occupancy > 0.95 or min_x <= 1 or max_x >= width - 2:
            hard.append("SEVERE_BODY_TRUNCATION")
        shoulder_width = abs(landmarks["left_shoulder"]["x"] - landmarks["right_shoulder"]["x"])
        hip_width = abs(landmarks["left_hip"]["x"] - landmarks["right_hip"]["x"])
        if view == "FRONT" and (shoulder_width < 0.08 or hip_width < 0.08):
            hard.append("WRONG_VIEW_ORIENTATION")
        if view == "SIDE" and (shoulder_width > 0.075 or hip_width > 0.075):
            hard.append("WRONG_VIEW_ORIENTATION")
        quality, quality_hard, quality_warnings = _quality(image, (min_x, min_y, max_x - min_x + 1, silhouette_height), cv2, np)
        hard.extend(quality_hard)
        warnings.extend(quality_warnings)
        if hard:
            priority = hard[0]
            corrections = {
                "HEAD_OUT_OF_FRAME": "Move back until the full head is inside the frame.",
                "FEET_OUT_OF_FRAME": "Move back until both feet are inside the frame.",
                "BODY_TOO_SMALL": "Move closer while keeping the entire body visible.",
                "SEVERE_BODY_TRUNCATION": "Move back and center the full body inside the guide.",
                "WRONG_VIEW_ORIENTATION": "Face directly forward for FRONT or rotate to a true profile for SIDE.",
                "SEVERE_BLUR": "Hold the phone steady and retake in brighter light.",
                "SEVERE_UNDEREXPOSURE": "Move to brighter, even lighting and retake.",
                "SEVERE_OVEREXPOSURE": "Avoid bright backlighting and retake.",
            }
            raise ProcessingError(422, priority, corrections.get(priority, "Retake the photograph with one full-body person visible."))
        geometry_started = time.perf_counter()
        mm_per_pixel = verified_height_mm / silhouette_height
        shoulder_y = (landmarks["left_shoulder"]["y"] + landmarks["right_shoulder"]["y"]) / 2
        hip_y = (landmarks["left_hip"]["y"] + landmarks["right_hip"]["y"]) / 2
        torso = hip_y - shoulder_y
        center_x = (landmarks["left_hip"]["x"] + landmarks["right_hip"]["x"]) * width / 2
        slices = {
            "chest": _scan_width(cleaned, (shoulder_y + 0.28 * torso) * height, center_x, np),
            "waist": _scan_band(cleaned, (shoulder_y + 0.52 * torso) * height, (shoulder_y + 0.82 * torso) * height, center_x, False, np),
            "hip": _scan_band(cleaned, (hip_y - 0.05 * torso) * height, (hip_y + 0.12 * torso) * height, center_x, True, np),
        }
        widths_mm = {}
        for name, (width_px, _) in slices.items():
            widths_mm[name] = round(width_px * mm_per_pixel, 4) if width_px else None
        def distance(first: str, second: str) -> float | None:
            a, b = landmarks.get(first), landmarks.get(second)
            if not _usable(a) or not _usable(b):
                return None
            return math.hypot((a["x"] - b["x"]) * width, (a["y"] - b["y"]) * height) * mm_per_pixel
        shoulder_length = distance("left_shoulder", "right_shoulder")
        arm_chains = []
        for side in ("left", "right"):
            names = [f"{side}_shoulder", f"{side}_elbow", f"{side}_wrist"]
            if all(_usable(landmarks.get(name)) for name in names):
                upper = distance(names[0], names[1]); lower = distance(names[1], names[2])
                arm_chains.append((sum(_score(landmarks.get(name)) for name in names), upper + lower))
        sleeve = max(arm_chains)[1] if arm_chains else None
        length_reason_codes = {
            "shoulder_width": [] if shoulder_length is not None else ["SHOULDER_LANDMARKS_UNCERTAIN"],
            "sleeve_length": [] if sleeve is not None else ["ARM_CHAIN_UNCERTAIN"],
            "armhole_depth": [],
        }
        armhole = abs((shoulder_y + 0.28 * torso) * height - shoulder_y * height) * mm_per_pixel
        pose_scores = [min(landmarks[name]["visibility"], landmarks[name]["presence"]) for name in required_landmarks]
        pose_quality = sum(pose_scores) / len(pose_scores)
        calibration_quality = max(0.0, 1 - math.hypot(10 / verified_height_mm, 3 / silhouette_height) * 10)
        bounding_area = (max_x - min_x + 1) * silhouette_height
        fill_ratio = float(cleaned.sum()) / max(1, bounding_area)
        row_coverage = float(np.count_nonzero(cleaned.any(axis=1))) / silhouette_height
        segmentation_quality = max(0.0, min(1.0, row_coverage * (1 - abs(fill_ratio - 0.5))))
        quality_score = max(0.0, min(1.0, quality["score"] * 0.30 + pose_quality * 0.30 + calibration_quality * 0.25 + segmentation_quality * 0.15))
        geometry = {
            "calibration": {"method": "VERIFIED_HEIGHT_WEAK_PERSPECTIVE", "mm_per_pixel": round(mm_per_pixel, 7), "quality": round(calibration_quality, 4)},
            "capture_quality": quality["score"],
            "lengths_mm": {"armhole_depth": round(armhole, 4), "shoulder_width": round(shoulder_length, 4) if shoulder_length else None, "sleeve_length": round(sleeve, 4) if sleeve else None},
            "length_reason_codes": length_reason_codes,
            "model_id": MODEL_ID,
            "model_runtime": MODEL_RUNTIME,
            "model_versions": [MODEL_ID, MODEL_RUNTIME, OPENCV_RUNTIME],
            "pose_quality": round(pose_quality, 4),
            "quality_score": round(quality_score, 4),
            "segmentation_quality": round(segmentation_quality, 4),
            "warnings": sorted(set(warnings + ["LOOSE_CLOTHING_LIMITATION"])),
            "widths_mm": widths_mm,
        }
        timings = {"decode_ms": decode_ms, "pose_and_segmentation_ms": pose_ms, "geometry_ms": (time.perf_counter() - geometry_started) * 1000, "total_ms": (time.perf_counter() - total_started) * 1000}
        if _model_initialization_ms is not None:
            timings["cold_model_initialization_ms"] = _model_initialization_ms
        return geometry, {key: round(value, 3) for key, value in timings.items()}
    finally:
        cleaned = None
        mask = None
        result = None
        image = None
