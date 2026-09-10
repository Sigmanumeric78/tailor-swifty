from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import app
from app.services import access_tokens


TEST_SIGNING_SECRET = b"backend-test-signing-secret-with-at-least-thirty-two-bytes"


@pytest.fixture(autouse=True)
def signing_secret(monkeypatch):
    monkeypatch.setattr(access_tokens, "get_camera_processing_signing_secret", lambda: TEST_SIGNING_SECRET)


@pytest.fixture
def db_factory():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    yield factory
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def client(db_factory) -> Generator[TestClient, None, None]:
    def override_db():
        with db_factory() as session:
            yield session

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def valid_measurements():
    return [
        {"measurement_code": "neck_circumference", "value": 39, "unit": "cm", "attempt_number": 1},
        {"measurement_code": "chest_circumference", "value": 100, "unit": "cm", "attempt_number": 1},
        {"measurement_code": "waist_circumference", "value": 86, "unit": "cm", "attempt_number": 1},
        {"measurement_code": "hip_circumference", "value": 98, "unit": "cm", "attempt_number": 1},
        {"measurement_code": "shoulder_width", "value": 46, "unit": "cm", "attempt_number": 1},
        {"measurement_code": "sleeve_length", "value": 64, "unit": "cm", "attempt_number": 1},
        {"measurement_code": "armhole_depth", "value": 24, "unit": "cm", "attempt_number": 1},
        {"measurement_code": "shirt_length", "value": 76, "unit": "cm", "attempt_number": 1},
    ]


def participant_headers(participant: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {participant['participant_access_token']}"}


def create_test_participant(client: TestClient) -> dict:
    response = client.post("/api/v1/participants", json={})
    assert response.status_code == 201
    participant = response.json()
    client.headers.update(participant_headers(participant))
    return participant


def build_session(client: TestClient) -> tuple[str, str]:
    participant = create_test_participant(client)
    consent = client.post(
        "/api/v1/consents/start",
        json={"participant_id": participant["id"], "granted": True},
    )
    assert consent.status_code == 201
    session = client.post(
        "/api/v1/measurement-sessions",
        json={
            "participant_id": participant["id"],
            "age_months_at_measurement": 360,
            "garment_categories": ["shirt"],
            "measurement_method": "self",
            "unit_entered": "cm",
        },
    )
    assert session.status_code == 201
    return participant["id"], session.json()["id"]
