import secrets
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import DomainError
from app.models import ConsentRecord, Participant
from app.repositories.records import get_participant
from app.schemas.contracts import ConsentStart


def create_participant(db: Session) -> Participant:
    for _ in range(3):
        participant = Participant(public_code=f"TOP-{secrets.token_hex(5).upper()}")
        db.add(participant)
        try:
            db.commit()
            db.refresh(participant)
            return participant
        except IntegrityError:
            db.rollback()
    raise DomainError(500, "PUBLIC_CODE_GENERATION_FAILED", "Could not create a unique participant code")


def start_consent(db: Session, payload: ConsentStart) -> ConsentRecord:
    participant = get_participant(db, payload.participant_id)
    if not participant:
        raise DomainError(404, "PARTICIPANT_NOT_FOUND", "Participant was not found")
    consent = ConsentRecord(
        participant_id=participant.id,
        consent_version=get_settings().consent_version,
        purpose=payload.purpose,
        granted=payload.granted,
        granted_at=datetime.now(UTC) if payload.granted else None,
    )
    db.add(consent)
    db.commit()
    db.refresh(consent)
    return consent

