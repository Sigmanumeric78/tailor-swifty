from tests.conftest import build_session


def test_missing_measurements_are_field_specific(client):
    _, session_id = build_session(client)
    response = client.post(
        f"/api/v1/measurement-sessions/{session_id}/measurements",
        json={"measurements": [{"measurement_code": "chest_circumference", "value": 100, "unit": "cm", "attempt_number": 1}]},
    )
    assert response.status_code == 201
    validation = client.post(f"/api/v1/measurement-sessions/{session_id}/validate").json()
    assert validation["valid"] is False
    missing = {issue["field"] for issue in validation["issues"] if issue["code"] == "MEASUREMENT_REQUIRED"}
    assert "neck_circumference" in missing
    assert "chest_circumference" not in missing


def test_negative_value_returns_structured_request_error(client):
    _, session_id = build_session(client)
    response = client.post(
        f"/api/v1/measurement-sessions/{session_id}/measurements",
        json={"measurements": [{"measurement_code": "chest_circumference", "value": -2, "unit": "cm", "attempt_number": 1}]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "REQUEST_VALIDATION_ERROR"


def test_unknown_measurement_code_is_rejected(client):
    _, session_id = build_session(client)
    response = client.post(
        f"/api/v1/measurement-sessions/{session_id}/measurements",
        json={"measurements": [{"measurement_code": "made_up", "value": 20, "unit": "cm", "attempt_number": 1}]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNKNOWN_MEASUREMENT_CODE"


def test_repeat_tolerance_requests_third_attempt(client, valid_measurements):
    _, session_id = build_session(client)
    measurements = valid_measurements + [
        {"measurement_code": "chest_circumference", "value": 104, "unit": "cm", "attempt_number": 2}
    ]
    assert client.post(f"/api/v1/measurement-sessions/{session_id}/measurements", json={"measurements": measurements}).status_code == 201
    validation = client.post(f"/api/v1/measurement-sessions/{session_id}/validate").json()
    assert validation["valid"] is True
    assert any(issue["code"] == "REPEAT_TOLERANCE_EXCEEDED" and issue["field"] == "chest_circumference" for issue in validation["issues"])


def test_duplicate_attempt_rolls_back_entire_batch(client):
    _, session_id = build_session(client)
    first = {"measurement_code": "chest_circumference", "value": 100, "unit": "cm", "attempt_number": 1}
    assert client.post(f"/api/v1/measurement-sessions/{session_id}/measurements", json={"measurements": [first]}).status_code == 201
    response = client.post(
        f"/api/v1/measurement-sessions/{session_id}/measurements",
        json={"measurements": [first, {"measurement_code": "waist_circumference", "value": 85, "unit": "cm", "attempt_number": 1}]},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "DUPLICATE_MEASUREMENT_ATTEMPT"
    validation = client.post(f"/api/v1/measurement-sessions/{session_id}/validate").json()
    assert "waist_circumference" not in validation["normalized_measurements"]
