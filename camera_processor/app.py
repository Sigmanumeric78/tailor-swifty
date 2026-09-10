"""AWS Lambda Function URL handler for stateless in-memory image processing."""

import base64
import binascii
import json
import os
from functools import lru_cache
from typing import Any

from geometry import MEASUREMENT_DEFINITION_VERSION, finalize_geometry
from runtime import MODEL_ID, MODEL_RUNTIME, OPENCV_RUNTIME, ProcessingError, process_image
from tokens import CAMERA_SESSION, PIPELINE_VERSION, TokenError, observation_token, verify_token


MAX_REQUEST_BYTES = 4_500_000
ALLOWED_MIME_TYPES = {"image/jpeg", "image/webp"}
ALLOWED_METADATA = {"width", "height", "frame_rate", "aspect_ratio", "roll", "pitch", "encoded_bytes"}


@lru_cache
def signing_secret() -> bytes:
    parameter_name = os.environ.get("CAMERA_PROCESSING_SIGNING_PARAMETER_NAME")
    if not parameter_name:
        raise RuntimeError("CAMERA_PROCESSING_SIGNING_PARAMETER_NAME is required")
    import boto3

    response = boto3.client("ssm").get_parameter(Name=parameter_name, WithDecryption=True)
    value = str(response["Parameter"]["Value"])
    if len(value.encode()) < 32:
        raise RuntimeError("Camera processing signing secret is too short")
    return value.encode()


def _headers(event: dict[str, Any]) -> dict[str, str]:
    return {str(key).lower(): str(value) for key, value in (event.get("headers") or {}).items()}


def _cors(event: dict[str, Any]) -> dict[str, str]:
    origin = _headers(event).get("origin")
    allowed = {item.strip() for item in os.environ.get("ALLOWED_ORIGINS", "").split(",") if item.strip()}
    headers = {"Content-Type": "application/json", "Cache-Control": "no-store"}
    if origin and origin in allowed:
        headers.update({"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST,OPTIONS", "Vary": "Origin"})
    return headers


def _response(event: dict[str, Any], status: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {"statusCode": status, "headers": _cors(event), "body": json.dumps(payload, separators=(",", ":"))}


def _error(event: dict[str, Any], status: int, code: str, message: str) -> dict[str, Any]:
    return _response(event, status, {"accepted": False, "error": {"code": code, "message": message}, "highest_priority_correction": message, "pipeline_version": PIPELINE_VERSION})


def _request(event: dict[str, Any]) -> dict[str, Any]:
    headers = _headers(event)
    if headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise ProcessingError(415, "UNSUPPORTED_CONTENT_TYPE", "Send a JSON request with one compressed photograph.")
    body = event.get("body")
    if event.get("isBase64Encoded"):
        try:
            body = base64.b64decode(body or "", validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError) as exc:
            raise ProcessingError(422, "INVALID_REQUEST", "The request body is invalid.") from exc
    if not isinstance(body, str) or len(body.encode("utf-8")) > MAX_REQUEST_BYTES:
        raise ProcessingError(413, "REQUEST_BYTES_EXCEEDED", "The complete request must remain below 4.5 MB.")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ProcessingError(422, "INVALID_REQUEST", "The request body is invalid.") from exc
    finally:
        # Drop the Lambda event's reference to the encoded request as soon as JSON
        # parsing completes. The selected photograph is never needed after analyze.
        event["body"] = ""
    if not isinstance(payload, dict):
        raise ProcessingError(422, "INVALID_REQUEST", "The request body is invalid.")
    return payload


def _validate_metadata(value: Any) -> dict[str, float]:
    if value is None:
        return {}
    if not isinstance(value, dict) or set(value) - ALLOWED_METADATA:
        raise ProcessingError(422, "INVALID_CAPTURE_METADATA", "Capture metadata must contain bounded numeric values only.")
    output = {}
    for key, item in value.items():
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not -100_000 <= float(item) <= 100_000:
            raise ProcessingError(422, "INVALID_CAPTURE_METADATA", "Capture metadata must contain bounded numeric values only.")
        output[key] = float(item)
    return output


def analyze(event: dict[str, Any], payload: dict[str, Any], secret: bytes) -> dict[str, Any]:
    required = {"session_token", "view", "verified_height_mm", "image_mime_type", "image_base64", "candidate_index"}
    if not required.issubset(payload) or set(payload) - required - {"client_capture_metadata"}:
        raise ProcessingError(422, "INVALID_REQUEST", "The analyze request contains unsupported or missing fields.")
    session = verify_token(payload["session_token"], secret, expected_type=CAMERA_SESSION)
    view = payload["view"]
    if view not in {"FRONT", "SIDE"}:
        raise ProcessingError(422, "INVALID_VIEW", "Choose FRONT or SIDE.")
    height = payload["verified_height_mm"]
    if isinstance(height, bool) or not isinstance(height, int) or not 1000 <= height <= 2500:
        raise ProcessingError(422, "INVALID_HEIGHT", "Enter a verified height from 100 to 250 cm.")
    index = payload["candidate_index"]
    if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index <= 2:
        raise ProcessingError(422, "INVALID_CANDIDATE_INDEX", "Candidate index must be zero, one, or two.")
    mime_type = payload["image_mime_type"]
    if mime_type not in ALLOWED_MIME_TYPES:
        raise ProcessingError(415, "UNSUPPORTED_IMAGE_FORMAT", "Use a JPEG or WebP photograph.")
    _validate_metadata(payload.get("client_capture_metadata"))
    image_base64 = payload["image_base64"]
    if not isinstance(image_base64, str) or len(image_base64) > 3_400_000:
        raise ProcessingError(413, "IMAGE_BYTES_EXCEEDED", "Compress the photograph below 2.5 MB and try again.")
    try:
        image_bytes = base64.b64decode(image_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ProcessingError(422, "INVALID_IMAGE_ENCODING", "The photograph encoding is invalid.") from exc
    payload["image_base64"] = ""
    image_base64 = ""
    try:
        geometry, timings = process_image(image_bytes, mime_type, view, height)
        geometry["candidate_index"] = index
        token, expires_at = observation_token(session, view, geometry, secret)
        return _response(event, 200, {
            "accepted": True,
            "highest_priority_correction": None,
            "quality_summary": {
                "calibration_quality": geometry["calibration"]["quality"],
                "capture_quality": geometry["capture_quality"],
                "pose_quality": geometry["pose_quality"],
                "quality_score": geometry["quality_score"],
                "reason_codes": geometry["warnings"],
                "segmentation_quality": geometry["segmentation_quality"],
            },
            "observation_token": token,
            "pipeline_version": PIPELINE_VERSION,
            "model_versions": [MODEL_ID, MODEL_RUNTIME, OPENCV_RUNTIME],
            "processing_timing_summary": timings,
            "expires_at": expires_at,
        })
    finally:
        image_bytes = b""


def finalize(event: dict[str, Any], payload: dict[str, Any], secret: bytes) -> dict[str, Any]:
    required = {"session_token", "front_observation_tokens", "side_observation_tokens"}
    if set(payload) != required:
        raise ProcessingError(422, "INVALID_REQUEST", "Finalization requires only matched front and side observation tokens.")
    session = verify_token(payload["session_token"], secret, expected_type=CAMERA_SESSION)
    front_tokens, side_tokens = payload["front_observation_tokens"], payload["side_observation_tokens"]
    if not isinstance(front_tokens, list) or not isinstance(side_tokens, list) or not 1 <= len(front_tokens) <= 3 or len(front_tokens) != len(side_tokens):
        raise ProcessingError(422, "MATCHED_FRONT_SIDE_OBSERVATIONS_REQUIRED", "Provide one to three matched front and side observations.")
    if len(set(front_tokens + side_tokens)) != len(front_tokens) + len(side_tokens):
        raise ProcessingError(422, "DUPLICATE_OBSERVATION", "Use independent front and side observations.")
    fronts, sides = [], []
    for token, expected_view, destination in [*((token, "FRONT", fronts) for token in front_tokens), *((token, "SIDE", sides) for token in side_tokens)]:
        observation = verify_token(token, secret, expected_type=f"{expected_view}_OBSERVATION")
        if observation.get("session_nonce") != session["nonce"]:
            raise TokenError("TOKEN_SESSION_MISMATCH")
        if observation.get("view") != expected_view:
            raise TokenError("TOKEN_VIEW_MISMATCH")
        destination.append(observation["geometry"])
    result = finalize_geometry(fronts, sides)
    return _response(event, 200, {
        **result,
        "calibration_method": "VERIFIED_HEIGHT_WEAK_PERSPECTIVE",
        "confidence_level": "high" if result["overall_quality_score"] >= 0.75 else "medium" if result["overall_quality_score"] >= 0.55 else "low",
        "manual_review_required": True,
        "measurement_definition_version": MEASUREMENT_DEFINITION_VERSION,
        "model_versions": [MODEL_ID, MODEL_RUNTIME, OPENCV_RUNTIME],
        "pipeline_version": PIPELINE_VERSION,
    })


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    method = (event.get("requestContext", {}).get("http", {}).get("method") or event.get("httpMethod") or "").upper()
    if method == "OPTIONS":
        return {"statusCode": 204, "headers": _cors(event), "body": ""}
    if method != "POST":
        return _error(event, 405, "METHOD_NOT_ALLOWED", "Use POST for camera processing.")
    origin = _headers(event).get("origin")
    allowed = {item.strip() for item in os.environ.get("ALLOWED_ORIGINS", "").split(",") if item.strip()}
    if origin and origin not in allowed:
        return _error(event, 403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed to use camera processing.")
    try:
        payload = _request(event)
        secret = signing_secret()
        path = event.get("rawPath") or event.get("path") or "/"
        if path == "/analyze":
            return analyze(event, payload, secret)
        if path == "/finalize":
            return finalize(event, payload, secret)
        return _error(event, 404, "NOT_FOUND", "Camera-processing route not found.")
    except ProcessingError as exc:
        return _error(event, exc.status, exc.code, exc.correction)
    except TokenError as exc:
        return _error(event, 401, str(exc), "The processing session expired or is invalid. Start the scan again.")
    except Exception:
        return _error(event, 500, "PROCESSING_FAILED", "Processing failed without retaining the photograph. Please retake it.")
