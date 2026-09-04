import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import DomainError
from app.data.catalog import GARMENTS
from app.data.measurement_definitions import get_measurement_definitions
from app.repositories.records import get_session
from app.schemas.contracts import (
    ConsentResponse,
    ConsentStart,
    MeasurementBatch,
    MeasurementSchemaResponse,
    MeasurementSessionCreate,
    MeasurementSessionResponse,
    MeasurementValueResponse,
    ParticipantCreate,
    ParticipantResponse,
    RecommendationCreate,
    RecommendationResponse,
    ValidationResponse,
)
from app.services.measurements import add_measurements, create_session, submit_session, validate_session
from app.services.participants import create_participant, start_consent
from app.services.recommendations import create_recommendation, get_recommendation


router = APIRouter()
Db = Annotated[Session, Depends(get_db)]


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "tailored-outfit-api"}


@router.get("/api/v1/measurement-schema", response_model=MeasurementSchemaResponse)
def measurement_schema(garments: str = Query("shirt")) -> dict:
    if garments != "shirt":
        raise DomainError(422, "UNSUPPORTED_GARMENT", "Only the shirt garment is supported in this slice")
    return {
        "garment": "shirt",
        "version": get_settings().measurement_schema_version,
        "range_notice": "These broad development ranges are configurable warnings, not medically or scientifically validated limits.",
        "fields": get_measurement_definitions(),
    }


@router.get("/api/v1/catalog")
def catalog(category: str = Query("shirt")) -> dict:
    if category != "shirt":
        raise DomainError(422, "UNSUPPORTED_GARMENT", "Only the shirt catalog is available in this slice")
    return {"version": get_settings().catalog_version, "items": GARMENTS}


@router.post("/api/v1/participants", response_model=ParticipantResponse, status_code=201)
def participants_create(_: ParticipantCreate, db: Db):
    return create_participant(db)


@router.post("/api/v1/consents/start", response_model=ConsentResponse, status_code=201)
def consents_start(payload: ConsentStart, db: Db):
    return start_consent(db, payload)


@router.post("/api/v1/measurement-sessions", response_model=MeasurementSessionResponse, status_code=201)
def sessions_create(payload: MeasurementSessionCreate, db: Db):
    return create_session(db, payload)


@router.post("/api/v1/measurement-sessions/{session_id}/measurements", response_model=list[MeasurementValueResponse], status_code=201)
def measurements_create(session_id: uuid.UUID, payload: MeasurementBatch, db: Db):
    return add_measurements(db, session_id, payload)


@router.post("/api/v1/measurement-sessions/{session_id}/validate", response_model=ValidationResponse)
def sessions_validate(session_id: uuid.UUID, db: Db):
    return validate_session(db, session_id)


@router.post("/api/v1/measurement-sessions/{session_id}/submit", response_model=MeasurementSessionResponse)
def sessions_submit(
    session_id: uuid.UUID,
    db: Db,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
):
    return submit_session(db, session_id, idempotency_key or "")


@router.post("/api/v1/recommendations", response_model=RecommendationResponse, status_code=201)
def recommendations_create(
    payload: RecommendationCreate,
    db: Db,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
):
    return create_recommendation(db, payload, idempotency_key or "")


@router.get("/api/v1/recommendations/{recommendation_id}", response_model=RecommendationResponse)
def recommendations_get(recommendation_id: uuid.UUID, db: Db):
    return get_recommendation(db, recommendation_id)

