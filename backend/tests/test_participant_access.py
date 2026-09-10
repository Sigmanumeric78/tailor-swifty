import base64
import json
import time
import uuid

from app.services.access_tokens import (
    FRONT_OBSERVATION,
    PARTICIPANT_ACCESS,
    TOKEN_SCHEMA_VERSION,
    issue_participant_access_token,
    sign_payload,
)
from tests.conftest import TEST_SIGNING_SECRET, create_test_participant, participant_headers


def _consent(client, participant, headers=None):
    return client.post(
        "/api/v1/consents/start",
        json={"participant_id": participant["id"], "granted": True},
        headers=headers,
    )


def test_correct_participant_token_authorizes_its_participant(client):
    participant = create_test_participant(client)
    response = _consent(client, participant)
    assert response.status_code == 201
    assert response.json()["participant_id"] == participant["id"]


def test_participant_a_token_cannot_access_participant_b(client):
    participant_a = create_test_participant(client)
    headers_a = participant_headers(participant_a)
    participant_b = create_test_participant(client)
    response = _consent(client, participant_b, headers=headers_a)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PARTICIPANT_ACCESS_MISMATCH"


def test_participant_token_cannot_access_another_participants_session(client):
    participant_a = create_test_participant(client)
    assert _consent(client, participant_a).status_code == 201
    session = client.post(
        "/api/v1/measurement-sessions",
        json={
            "participant_id": participant_a["id"],
            "age_months_at_measurement": 360,
            "garment_categories": ["shirt"],
            "unit_entered": "cm",
        },
    )
    assert session.status_code == 201
    create_test_participant(client)
    response = client.post(f"/api/v1/measurement-sessions/{session.json()['id']}/validate")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "PARTICIPANT_ACCESS_MISMATCH"


def test_participant_uuid_without_token_is_rejected(client):
    participant = create_test_participant(client)
    del client.headers["Authorization"]
    response = _consent(client, participant)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "PARTICIPANT_ACCESS_REQUIRED"

    malformed = _consent(
        client, participant, headers={"Authorization": "Bearer malformed-token"}
    )
    assert malformed.status_code == 401
    assert malformed.json()["error"]["code"] == "TOKEN_INVALID"


def test_expired_and_modified_tokens_are_rejected(client):
    participant = create_test_participant(client)
    expired, _ = issue_participant_access_token(
        uuid.UUID(participant["id"]), now=1, secret=TEST_SIGNING_SECRET
    )
    expired_response = _consent(
        client, participant, headers={"Authorization": f"Bearer {expired}"}
    )
    assert expired_response.status_code == 401
    assert expired_response.json()["error"]["code"] == "TOKEN_EXPIRED"

    token = participant["participant_access_token"]
    modified = token[:-1] + ("A" if token[-1] != "A" else "B")
    modified_response = _consent(
        client, participant, headers={"Authorization": f"Bearer {modified}"}
    )
    assert modified_response.status_code == 401
    assert modified_response.json()["error"]["code"] == "TOKEN_TAMPERED"


def test_observation_token_cannot_authorize_participant_route(client):
    participant = create_test_participant(client)
    now = int(time.time())
    observation = sign_payload(
        {
            "exp": now + 600,
            "iat": now,
            "nonce": "observation-nonce",
            "schema_version": TOKEN_SCHEMA_VERSION,
            "token_type": FRONT_OBSERVATION,
            "view": "FRONT",
        },
        TEST_SIGNING_SECRET,
    )
    response = _consent(
        client, participant, headers={"Authorization": f"Bearer {observation}"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "TOKEN_TYPE_MISMATCH"


def test_participant_token_and_request_body_are_not_logged(client, caplog):
    participant = create_test_participant(client)
    token = participant["participant_access_token"]
    response = _consent(client, participant)
    assert response.status_code == 201
    rendered_logs = "\n".join(record.getMessage() for record in caplog.records)
    assert token not in rendered_logs
    assert participant["id"] not in rendered_logs


def test_participant_token_shape_is_short_lived_and_purpose_bound(client):
    participant = create_test_participant(client)
    token = participant["participant_access_token"]
    assert token.count(".") == 1
    assert participant["access_token_expires_at"] > int(time.time())
    assert participant["access_token_expires_at"] - int(time.time()) <= 1800
    encoded = token.split(".", 1)[0]
    encoded += "=" * (-len(encoded) % 4)
    payload = json.loads(base64.urlsafe_b64decode(encoded))
    assert payload["participant_id"] == participant["id"]
    assert payload["token_type"] == PARTICIPANT_ACCESS
    assert payload["schema_version"] == TOKEN_SCHEMA_VERSION
    assert payload["exp"] > payload["iat"]
    assert payload["nonce"]


def test_cors_allows_required_headers_only_for_configured_origin(client):
    response = client.options(
        "/api/v1/consents/start",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed_headers
    assert "content-type" in allowed_headers

    denied = client.options(
        "/api/v1/consents/start",
        headers={
            "Origin": "https://unrelated.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert "access-control-allow-origin" not in denied.headers


def test_raw_media_and_token_shaped_persistence_fields_are_rejected(client):
    rejected_participant = client.post(
        "/api/v1/participants", json={"image_base64": "forbidden"}
    )
    assert rejected_participant.status_code == 422

    participant = create_test_participant(client)
    assert _consent(client, participant).status_code == 201
    rejected_preferences = client.post(
        "/api/v1/recommendations",
        headers={"Idempotency-Key": "safe-key"},
        json={
            "measurement_session_id": str(uuid.uuid4()),
            "preferences": {
                "occasion": "casual",
                "climate": "mild",
                "fit": "regular",
                "styles": ["data:image/jpeg;base64,raw-media"],
            },
        },
    )
    assert rejected_preferences.status_code == 422

    session = client.post(
        "/api/v1/measurement-sessions",
        json={
            "participant_id": participant["id"],
            "age_months_at_measurement": 360,
            "garment_categories": ["shirt"],
            "unit_entered": "cm",
        },
    )
    assert session.status_code == 201
    token_as_key = client.post(
        f"/api/v1/measurement-sessions/{session.json()['id']}/submit",
        headers={"Idempotency-Key": participant["participant_access_token"]},
    )
    assert token_as_key.status_code == 400
    assert token_as_key.json()["error"]["code"] == "IDEMPOTENCY_KEY_INVALID"
