import base64
import importlib.util
import json
from pathlib import Path

from runtime import ProcessingError
from tokens import CAMERA_SESSION, PIPELINE_VERSION, sign_payload

spec = importlib.util.spec_from_file_location("camera_processor_handler", Path(__file__).parents[1] / "app.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


SECRET = b"handler-test-secret-with-at-least-thirty-two-bytes"
ORIGIN = "https://preview.example"


def event(path, payload, origin=ORIGIN):
    return {"rawPath": path, "requestContext": {"http": {"method": "POST"}}, "headers": {"content-type": "application/json", "origin": origin}, "body": json.dumps(payload)}


def session(nonce="session-a", now=1000):
    return sign_payload({"allowed_view_count": 6, "exp": now + 300, "iat": now, "nonce": nonce, "pipeline_version": PIPELINE_VERSION, "schema_version": "1", "token_type": CAMERA_SESSION, "view": "SESSION"}, SECRET)


def request(view, token=None):
    return {"session_token": token or session(), "view": view, "verified_height_mm": 1800, "image_mime_type": "image/jpeg", "image_base64": base64.b64encode(b"synthetic-image").decode(), "candidate_index": 0, "client_capture_metadata": {"width": 1280, "height": 960}}


def geometry():
    return {"calibration": {"method": "VERIFIED_HEIGHT_WEAK_PERSPECTIVE", "mm_per_pixel": 2, "quality": 0.9}, "capture_quality": 0.8, "lengths_mm": {"shoulder_width": 460, "sleeve_length": 640, "armhole_depth": 240}, "model_id": "model", "model_runtime": "runtime", "pose_quality": 0.8, "quality_score": 0.8, "segmentation_quality": 0.8, "warnings": [], "widths_mm": {"neck": 120, "chest": 320, "waist": 280, "hip": 330}}


def setup(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", ORIGIN); monkeypatch.setattr(app, "signing_secret", lambda: SECRET); monkeypatch.setattr("tokens.time.time", lambda: 1001)


def test_front_and_side_are_separate_and_finalize_without_images(monkeypatch):
    setup(monkeypatch); monkeypatch.setattr(app, "process_image", lambda image, mime, view, height: (geometry(), {"total_ms": 1}))
    monkeypatch.setattr("tokens.time.time", lambda: 1001)
    front = json.loads(app.handler(event("/analyze", request("FRONT")), None)["body"])
    side = json.loads(app.handler(event("/analyze", request("SIDE")), None)["body"])
    assert front["accepted"] and side["accepted"]
    finalized = app.handler(event("/finalize", {"session_token": session(), "front_observation_tokens": [front["observation_token"]], "side_observation_tokens": [side["observation_token"]]}), None)
    body = json.loads(finalized["body"])
    assert finalized["statusCode"] == 200
    assert body["measurements"]["shirt_length"]["value_mm"] is None
    assert "image" not in json.dumps(body).lower()


def test_cross_session_observation_is_rejected(monkeypatch):
    setup(monkeypatch); monkeypatch.setattr(app, "process_image", lambda image, mime, view, height: (geometry(), {})); monkeypatch.setattr("tokens.time.time", lambda: 1001)
    front = json.loads(app.handler(event("/analyze", request("FRONT")), None)["body"])["observation_token"]
    side = json.loads(app.handler(event("/analyze", request("SIDE")), None)["body"])["observation_token"]
    response = app.handler(event("/finalize", {"session_token": session("session-b"), "front_observation_tokens": [front], "side_observation_tokens": [side]}), None)
    assert response["statusCode"] == 401


def test_participant_access_token_cannot_replace_session_or_observation(monkeypatch):
    setup(monkeypatch)
    participant_token = sign_payload(
        {"exp": 1300, "iat": 1000, "nonce": "participant", "participant_id": "00000000-0000-0000-0000-000000000001", "schema_version": "1", "token_type": "PARTICIPANT_ACCESS"},
        SECRET,
    )
    rejected_session = app.handler(event("/analyze", request("FRONT", participant_token)), None)
    assert rejected_session["statusCode"] == 401

    monkeypatch.setattr(app, "process_image", lambda image, mime, view, height: (geometry(), {}))
    front = json.loads(app.handler(event("/analyze", request("FRONT")), None)["body"])["observation_token"]
    rejected_observation = app.handler(
        event("/finalize", {"session_token": session(), "front_observation_tokens": [participant_token], "side_observation_tokens": [front]}),
        None,
    )
    assert rejected_observation["statusCode"] == 401


def test_unsupported_and_oversized_requests_fail_before_inference(monkeypatch):
    setup(monkeypatch); invoked = False
    def should_not_run(*args):
        nonlocal invoked; invoked = True
    monkeypatch.setattr(app, "process_image", should_not_run)
    unsupported = request("FRONT"); unsupported["image_mime_type"] = "image/png"
    assert app.handler(event("/analyze", unsupported), None)["statusCode"] == 415
    oversized = request("FRONT"); oversized["image_base64"] = "A" * 3_400_001
    assert app.handler(event("/analyze", oversized), None)["statusCode"] == 413
    assert invoked is False


def test_safe_error_never_echoes_raw_image(monkeypatch):
    setup(monkeypatch); monkeypatch.setattr(app, "process_image", lambda *args: (_ for _ in ()).throw(ProcessingError(422, "NO_PERSON", "Keep one person visible.")))
    response = app.handler(event("/analyze", request("FRONT")), None)
    assert response["statusCode"] == 422
    assert "synthetic-image" not in response["body"]
    assert "base64" not in response["body"].lower()


def test_raw_request_references_are_cleared_after_analysis(monkeypatch):
    setup(monkeypatch)
    monkeypatch.setattr(app, "process_image", lambda image, mime, view, height: (geometry(), {}))
    payload = request("FRONT")
    request_event = event("/analyze", payload)
    response = app.handler(request_event, None)
    assert response["statusCode"] == 200
    assert request_event["body"] == ""


def test_cors_allows_only_the_configured_browser_origin(monkeypatch):
    setup(monkeypatch)
    allowed = app.handler({"rawPath": "/analyze", "requestContext": {"http": {"method": "OPTIONS"}}, "headers": {"origin": ORIGIN}}, None)
    denied = app.handler(event("/analyze", request("FRONT"), origin="https://unrelated.example"), None)
    assert allowed["statusCode"] == 204
    assert allowed["headers"]["Access-Control-Allow-Origin"] == ORIGIN
    assert denied["statusCode"] == 403
    assert "Access-Control-Allow-Origin" not in denied["headers"]
