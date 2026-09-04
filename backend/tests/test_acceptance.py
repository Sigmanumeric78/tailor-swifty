from sqlalchemy import func, select

from app.models import RecommendationRun
from tests.conftest import build_session


def test_fixed_acceptance_journey_is_exact_and_idempotent(client, db_factory, valid_measurements):
    _, session_id = build_session(client)
    added = client.post(
        f"/api/v1/measurement-sessions/{session_id}/measurements",
        json={"measurements": valid_measurements},
    )
    assert added.status_code == 201

    validation = client.post(f"/api/v1/measurement-sessions/{session_id}/validate")
    assert validation.status_code == 200
    assert validation.json()["valid"] is True

    submit_headers = {"Idempotency-Key": "acceptance-submit-001"}
    first_submit = client.post(f"/api/v1/measurement-sessions/{session_id}/submit", headers=submit_headers)
    second_submit = client.post(f"/api/v1/measurement-sessions/{session_id}/submit", headers=submit_headers)
    assert first_submit.status_code == second_submit.status_code == 200
    assert first_submit.json()["id"] == second_submit.json()["id"]

    request = {
        "measurement_session_id": session_id,
        "preferences": {
            "occasion": "smart-casual",
            "climate": "hot",
            "fit": "relaxed",
            "styles": ["minimal"],
            "colours": ["white"],
            "preferred_fabrics": ["linen"],
            "avoid_fabrics": [],
        },
    }
    headers = {"Idempotency-Key": "acceptance-rec-001"}
    first = client.post("/api/v1/recommendations", json=request, headers=headers)
    second = client.post("/api/v1/recommendations", json=request, headers=headers)
    assert first.status_code == second.status_code == 201
    result = first.json()
    assert result == second.json()
    assert result["garment_template"]["id"] == "shirt-breathable-linen"
    assert result["total_score"] == 100
    assert result["score_breakdown"] == {"occasion": 30, "climate_and_fabric": 20, "fit": 20, "style": 15, "colour": 15}
    assert result["normalized_body_measurements"]["chest_circumference"] == 1000
    assert result["target_finished_measurements"]["chest_circumference"] == 1160
    assert result["rules_version"] == result["catalog_version"] == result["measurement_schema_version"] == "1"

    fetched = client.get(f"/api/v1/recommendations/{result['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == result
    with db_factory() as db:
        assert db.scalar(select(func.count()).select_from(RecommendationRun)) == 1


def test_submission_requires_idempotency_key(client, valid_measurements):
    _, session_id = build_session(client)
    client.post(f"/api/v1/measurement-sessions/{session_id}/measurements", json={"measurements": valid_measurements})
    response = client.post(f"/api/v1/measurement-sessions/{session_id}/submit")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"
