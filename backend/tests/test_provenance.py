from tests.conftest import build_session


def test_legacy_session_payload_receives_safe_provenance_defaults(client):
    participant_id, _ = build_session(client)
    assert participant_id


def test_camera_session_accepts_versioned_provenance_without_raw_media(client):
    participant = client.post("/api/v1/participants", json={}).json()
    assert client.post("/api/v1/consents/start", json={"participant_id": participant["id"], "granted": True}).status_code == 201
    payload = {
        "participant_id": participant["id"], "age_months_at_measurement": 360,
        "garment_categories": ["shirt"], "measurement_method": "self", "unit_entered": "cm",
        "input_mode": "CAMERA_MEASUREMENTS", "capture_source": "photo_import",
        "calibration_mode": "VERIFIED_HEIGHT", "confidence_version": "camera-measurement-0.2.1",
        "model_versions": ["mediapipe-pose-landmarker-full-float16-v1"],
        "reason_codes": ["REPEATABILITY_NOT_ASSESSED"], "manually_reviewed": True,
        "device_capability_summary": {"width": 1920, "height": 1080, "facing_mode": "environment"},
    }
    response = client.post("/api/v1/measurement-sessions", json=payload)
    assert response.status_code == 201
    body = response.json()
    assert body["input_mode"] == "CAMERA_MEASUREMENTS"
    assert body["capture_source"] == "photo_import"
    assert body["manually_reviewed"] is True
    serialized = str(body).lower()
    assert all(term not in serialized for term in ["blob", "base64", "landmarks", "filename", "device_label"])


def test_session_contract_rejects_raw_media_fields(client):
    participant = client.post("/api/v1/participants", json={}).json()
    client.post("/api/v1/consents/start", json={"participant_id": participant["id"], "granted": True})
    response = client.post("/api/v1/measurement-sessions", json={
        "participant_id": participant["id"], "age_months_at_measurement": 360, "garment_categories": ["shirt"],
        "measurement_method": "self", "unit_entered": "cm", "image_base64": "forbidden",
    })
    assert response.status_code == 422


def test_session_contract_rejects_media_like_provenance_values(client):
    participant = client.post("/api/v1/participants", json={}).json()
    client.post("/api/v1/consents/start", json={"participant_id": participant["id"], "granted": True})
    response = client.post("/api/v1/measurement-sessions", json={
        "participant_id": participant["id"], "age_months_at_measurement": 360, "garment_categories": ["shirt"],
        "measurement_method": "self", "unit_entered": "cm", "model_versions": ["data:image/jpeg;base64"],
    })
    assert response.status_code == 422
