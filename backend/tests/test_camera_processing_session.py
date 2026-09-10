import base64
import json

from app.services import camera_processing
from tests.conftest import create_test_participant


SECRET = b"camera-processor-test-secret-that-is-at-least-32-bytes"


def _participant_with_recommendation_consent(client):
    participant = create_test_participant(client)
    assert client.post("/api/v1/consents/start", json={"participant_id": participant["id"], "granted": True}).status_code == 201
    return participant


def test_camera_processing_session_requires_separate_explicit_consent(client, monkeypatch):
    monkeypatch.setattr(camera_processing, "get_camera_processing_signing_secret", lambda: SECRET)
    participant = _participant_with_recommendation_consent(client)
    response = client.post("/api/v1/camera-processing/session", json={"participant_id": participant["id"], "server_image_processing_consent": True})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CAMERA_PROCESSING_CONSENT_REQUIRED"


def test_camera_processing_session_is_short_lived_and_privacy_safe(client, monkeypatch):
    monkeypatch.setattr(camera_processing, "get_camera_processing_signing_secret", lambda: SECRET)
    participant = _participant_with_recommendation_consent(client)
    consent = client.post("/api/v1/consents/start", json={"participant_id": participant["id"], "purpose": "server_camera_processing", "granted": True})
    assert consent.status_code == 201
    response = client.post("/api/v1/camera-processing/session", json={"participant_id": participant["id"], "server_image_processing_consent": True})
    assert response.status_code == 200
    body = response.json(); encoded = body["session_token"].split(".")[0]; encoded += "=" * (-len(encoded) % 4)
    token_payload = json.loads(base64.urlsafe_b64decode(encoded))
    assert token_payload["exp"] - token_payload["iat"] == 300
    assert token_payload["allowed_view_count"] == 6
    assert token_payload["view"] == "SESSION"
    assert token_payload["token_type"] == "CAMERA_SESSION"
    assert not any(key in token_payload for key in ["participant_id", "image", "base64", "landmarks", "filename", "exif"])


def test_camera_processing_session_rejects_raw_media_fields(client, monkeypatch):
    monkeypatch.setattr(camera_processing, "get_camera_processing_signing_secret", lambda: SECRET)
    participant = _participant_with_recommendation_consent(client)
    response = client.post("/api/v1/camera-processing/session", json={"participant_id": participant["id"], "server_image_processing_consent": True, "image_base64": "forbidden"})
    assert response.status_code == 422


def test_server_camera_provenance_is_additive_and_numeric_only(client):
    participant = _participant_with_recommendation_consent(client)
    response = client.post("/api/v1/measurement-sessions", json={
        "participant_id": participant["id"], "age_months_at_measurement": 360, "garment_categories": ["shirt"],
        "measurement_method": "self", "unit_entered": "cm", "input_mode": "CAMERA_MEASUREMENTS",
        "capture_source": "SERVER_CAMERA", "calibration_mode": "VERIFIED_HEIGHT",
        "confidence_version": "server-camera-0.1.0", "model_versions": ["mediapipe-0.10.21"],
        "reason_codes": ["REPEATABILITY_NOT_ASSESSED"], "manually_reviewed": True,
    })
    assert response.status_code == 201
    assert response.json()["capture_source"] == "SERVER_CAMERA"
