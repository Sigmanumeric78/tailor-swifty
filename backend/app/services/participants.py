import secrets
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import DomainError
from app.models import ConsentRecord, Participant
from app.repositories.records import get_participant
from app.schemas.contracts import ConsentStart
from app.services import access_tokens


def create_participant(db: Session) -> dict:
    # Resolve the dedicated key before committing a participant. If key access is
    # misconfigured, no inaccessible orphan participant is created.
    signing_secret = access_tokens.get_camera_processing_signing_secret()
    for _ in range(3):
        participant = Participant(public_code=f"TOP-{secrets.token_hex(5).upper()}")
        db.add(participant)
        try:
            db.commit()
            db.refresh(participant)
            token, expires_at = access_tokens.issue_participant_access_token(
                participant.id, secret=signing_secret
            )
            return {
                "id": participant.id,
                "public_code": participant.public_code,
                "status": participant.status,
                "created_at": participant.created_at,
                "participant_access_token": token,
                "access_token_expires_at": expires_at,
            }
        except IntegrityError:
            db.rollback()
    raise DomainError(500, "PUBLIC_CODE_GENERATION_FAILED", "Could not create a unique participant code")


def start_consent(db: Session, payload: ConsentStart) -> ConsentRecord:
    participant = get_participant(db, payload.participant_id)
    if not participant:
        raise DomainError(404, "PARTICIPANT_NOT_FOUND", "Participant was not found")
    consent = ConsentRecord(
        participant_id=participant.id,
        consent_version=(
            get_settings().camera_processing_consent_version
            if payload.purpose == "server_camera_processing"
            else get_settings().consent_version
        ),
        purpose=payload.purpose,
        granted=payload.granted,
        granted_at=datetime.now(UTC) if payload.granted else None,
    )
    db.add(consent)
    db.commit()
    db.refresh(consent)
    return consent
