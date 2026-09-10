import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ConsentRecord, MeasurementSession, Participant, RecommendationRun


def get_participant(db: Session, participant_id: uuid.UUID) -> Participant | None:
    return db.get(Participant, participant_id)


def get_session(db: Session, session_id: uuid.UUID) -> MeasurementSession | None:
    return db.get(MeasurementSession, session_id)


def has_active_consent(db: Session, participant_id: uuid.UUID, purpose: str, consent_version: str | None = None) -> bool:
    statement = select(ConsentRecord.id).where(
        ConsentRecord.participant_id == participant_id,
        ConsentRecord.purpose == purpose,
        ConsentRecord.granted.is_(True),
        ConsentRecord.withdrawn_at.is_(None),
    )
    if consent_version is not None:
        statement = statement.where(ConsentRecord.consent_version == consent_version)
    return db.scalar(statement) is not None


def get_recommendation_by_key(db: Session, key: str) -> RecommendationRun | None:
    return db.scalar(select(RecommendationRun).where(RecommendationRun.idempotency_key == key))


def get_recommendation_record(db: Session, recommendation_id: uuid.UUID) -> RecommendationRun | None:
    return db.get(RecommendationRun, recommendation_id)
