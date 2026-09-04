import statistics
import uuid
from collections import defaultdict

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import DomainError
from app.data.measurement_definitions import get_measurement_definitions
from app.models import MeasurementSession, MeasurementValue
from app.repositories.records import get_participant, get_session, has_active_consent
from app.schemas.contracts import MeasurementBatch, MeasurementSessionCreate
from app.services.units import to_millimetres


PURPOSE = "generate_outfit_recommendation"


def create_session(db: Session, payload: MeasurementSessionCreate) -> MeasurementSession:
    if not get_participant(db, payload.participant_id):
        raise DomainError(404, "PARTICIPANT_NOT_FOUND", "Participant was not found")
    if not has_active_consent(db, payload.participant_id, PURPOSE):
        raise DomainError(403, "CONSENT_REQUIRED", "Active recommendation consent is required")
    settings = get_settings()
    session = MeasurementSession(
        participant_id=payload.participant_id,
        age_months_at_measurement=payload.age_months_at_measurement,
        garment_categories=payload.garment_categories,
        measurement_method=payload.measurement_method,
        unit_entered=payload.unit_entered,
        protocol_version=settings.protocol_version,
        measurement_schema_version=settings.measurement_schema_version,
        status="draft",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def add_measurements(db: Session, session_id: uuid.UUID, payload: MeasurementBatch) -> list[MeasurementValue]:
    session = get_session(db, session_id)
    if not session:
        raise DomainError(404, "SESSION_NOT_FOUND", "Measurement session was not found")
    if session.status not in {"draft", "validated", "flagged"}:
        raise DomainError(409, "SESSION_FINALIZED", "Measurements cannot be changed after submission")
    known_codes = {item["code"] for item in get_measurement_definitions()}
    unknown = sorted({item.measurement_code for item in payload.measurements} - known_codes)
    if unknown:
        raise DomainError(422, "UNKNOWN_MEASUREMENT_CODE", "One or more measurement codes are unsupported", {"codes": unknown})

    records = [
        MeasurementValue(
            session_id=session.id,
            measurement_code=item.measurement_code,
            value_mm=to_millimetres(item.value, item.unit),
            attempt_number=item.attempt_number,
            confidence=item.confidence,
            validation_status="pending",
        )
        for item in payload.measurements
    ]
    db.add_all(records)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise DomainError(409, "DUPLICATE_MEASUREMENT_ATTEMPT", "This measurement attempt already exists") from exc
    for record in records:
        db.refresh(record)
    return records


def validate_session(db: Session, session_id: uuid.UUID) -> dict:
    session = get_session(db, session_id)
    if not session:
        raise DomainError(404, "SESSION_NOT_FOUND", "Measurement session was not found")
    definitions = get_measurement_definitions()
    grouped: dict[str, list[MeasurementValue]] = defaultdict(list)
    for value in session.values:
        grouped[value.measurement_code].append(value)

    issues: list[dict] = []
    normalized: dict[str, int] = {}
    for definition in definitions:
        code = definition["code"]
        attempts = sorted(grouped.get(code, []), key=lambda item: item.attempt_number)
        if not attempts:
            issues.append({"level": "error", "code": "MEASUREMENT_REQUIRED", "field": code, "message": f"{definition['label']} is required."})
            continue
        values = [item.value_mm for item in attempts]
        normalized[code] = round(statistics.median(values))
        if normalized[code] < definition["warning_min_mm"] or normalized[code] > definition["warning_max_mm"]:
            issues.append({"level": "warning", "code": "UNUSUAL_MEASUREMENT", "field": code, "message": f"{definition['label']} is outside the broad development range; confirm the tape placement and value."})
        if len(values) >= 2 and max(values) - min(values) > get_settings().repeat_tolerance_mm:
            issues.append({"level": "warning", "code": "REPEAT_TOLERANCE_EXCEEDED", "field": code, "message": f"{definition['label']} attempts differ by more than {get_settings().repeat_tolerance_mm} mm; add a third attempt."})

    if "neck_circumference" in normalized and "chest_circumference" in normalized and normalized["neck_circumference"] >= normalized["chest_circumference"]:
        issues.append({"level": "warning", "code": "INCONSISTENT_RELATIONSHIP", "field": "chest_circumference", "message": "Chest circumference is not greater than neck circumference; confirm both values."})

    issues.append({"level": "information", "code": "OPTIONAL_MEASUREMENTS_AVAILABLE", "field": None, "message": "Optional back-width and cuff measurements can improve precision in a future fitting phase."})

    error_count = sum(issue["level"] == "error" for issue in issues)
    warning_count = sum(issue["level"] == "warning" for issue in issues)
    quality_score = max(0, 100 - error_count * 12 - warning_count * 5)
    session.quality_score = quality_score
    session.status = "validated" if error_count == 0 and warning_count == 0 else "flagged"
    for values in grouped.values():
        for value in values:
            value.validation_status = "valid" if not any(i.get("field") == value.measurement_code and i["level"] == "error" for i in issues) else "invalid"
    db.commit()
    return {"valid": error_count == 0, "status": session.status, "quality_score": quality_score, "normalized_measurements": normalized, "issues": issues}


def submit_session(db: Session, session_id: uuid.UUID, idempotency_key: str) -> MeasurementSession:
    if not idempotency_key.strip():
        raise DomainError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required")
    session = get_session(db, session_id)
    if not session:
        raise DomainError(404, "SESSION_NOT_FOUND", "Measurement session was not found")
    if session.submission_idempotency_key:
        if session.submission_idempotency_key == idempotency_key:
            return session
        raise DomainError(409, "SESSION_ALREADY_SUBMITTED", "The session was already submitted with another key")
    validation = validate_session(db, session_id)
    if not validation["valid"]:
        raise DomainError(422, "MEASUREMENT_VALIDATION_FAILED", "Required measurements must be corrected before submission", validation["issues"])
    session.submission_idempotency_key = idempotency_key
    has_warnings = any(issue["level"] == "warning" for issue in validation["issues"])
    session.status = "flagged" if has_warnings else "accepted"
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise DomainError(409, "IDEMPOTENCY_KEY_CONFLICT", "This submission key is already in use") from exc
    db.refresh(session)
    return session
