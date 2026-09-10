"""Issue short-lived stateless tokens for the isolated camera processor."""

import secrets
import time

from sqlalchemy.orm import Session

from app.core.config import get_camera_processing_signing_secret, get_settings
from app.core.errors import DomainError
from app.repositories.records import get_participant, has_active_consent
from app.schemas.contracts import CameraProcessingSessionCreate
from app.services.access_tokens import CAMERA_SESSION, TOKEN_SCHEMA_VERSION, sign_payload


PIPELINE_VERSION = "server-camera-0.1.0"
SESSION_TTL_SECONDS = 300
ALLOWED_VIEW_COUNT = 6


def create_processing_session(
    db: Session,
    request: CameraProcessingSessionCreate,
    *,
    now: int | None = None,
    secret: bytes | None = None,
) -> dict:
    settings = get_settings()
    participant = get_participant(db, request.participant_id)
    if not participant:
        raise DomainError(404, "PARTICIPANT_NOT_FOUND", "Participant was not found")
    if not has_active_consent(db, participant.id, "generate_outfit_recommendation", settings.consent_version):
        raise DomainError(403, "CONSENT_REQUIRED", "Recommendation consent is required")
    if not has_active_consent(db, participant.id, "server_camera_processing", settings.camera_processing_consent_version):
        raise DomainError(403, "CAMERA_PROCESSING_CONSENT_REQUIRED", "Server image-processing consent is required")
    issued_at = int(time.time() if now is None else now)
    expires_at = issued_at + SESSION_TTL_SECONDS
    payload = {
        "allowed_view_count": ALLOWED_VIEW_COUNT,
        "exp": expires_at,
        "iat": issued_at,
        "nonce": secrets.token_urlsafe(18),
        "pipeline_version": PIPELINE_VERSION,
        "schema_version": TOKEN_SCHEMA_VERSION,
        "token_type": CAMERA_SESSION,
        "view": "SESSION",
    }
    token = sign_payload(payload, secret or get_camera_processing_signing_secret())
    return {
        "session_token": token,
        "token_schema_version": TOKEN_SCHEMA_VERSION,
        "pipeline_version": PIPELINE_VERSION,
        "expires_at": expires_at,
        "allowed_view_count": ALLOWED_VIEW_COUNT,
    }
