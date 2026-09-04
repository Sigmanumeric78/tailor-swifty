import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import DomainError
from app.data.catalog import EASE_PROFILES, GARMENTS
from app.models import RecommendationRun
from app.repositories.records import get_recommendation_by_key, get_session, has_active_consent
from app.schemas.contracts import Preferences, RecommendationCreate
from app.services.measurements import PURPOSE, validate_session


def _score(garment: dict, preferences: Preferences) -> tuple[int, int, dict[str, int], list[str]]:
    occasion = 30 if preferences.occasion in garment["occasion_tags"] else 0
    climate = 12 if preferences.climate in garment["climate_tags"] else 0
    fabric = 8 if not preferences.preferred_fabrics or garment["fabric"] in preferences.preferred_fabrics else 0
    fit = 20 if preferences.fit in garment["fit_tags"] else 0
    style = 15 if set(preferences.styles) & set(garment["style_tags"]) else 0
    colour = 15 if set(preferences.colours) & set(garment["colours"]) else 0
    breakdown = {
        "occasion": occasion,
        "climate_and_fabric": climate + fabric,
        "fit": fit,
        "style": style,
        "colour": colour,
    }
    exact_matches = sum(value > 0 for value in [occasion, climate, fabric, fit, style, colour])
    reasons = []
    if occasion:
        reasons.append(f"Designed for {preferences.occasion.replace('-', ' ')} occasions.")
    if climate:
        reasons.append(f"Its fabric profile suits {preferences.climate} conditions.")
    if fit:
        reasons.append(f"Supports the selected {preferences.fit} fit profile.")
    if style:
        reasons.append("Its style tags overlap your preferences.")
    if colour:
        reasons.append("Available colours include one of your choices.")
    if not reasons:
        reasons.append("This is the closest compatible shirt in the current catalog.")
    return sum(breakdown.values()), exact_matches, breakdown, reasons


def rank_garments(candidates: list[dict], preferences: Preferences) -> list[tuple]:
    ranked = []
    for garment in candidates:
        total, exact, breakdown, reasons = _score(garment, preferences)
        ranked.append((total, exact, garment["id"], garment, breakdown, reasons))
    return sorted(ranked, key=lambda item: (-item[0], -item[1], item[2]))


def _result_from_run(run: RecommendationRun) -> dict:
    return {
        "id": run.id,
        "measurement_session_id": run.session_id,
        **run.result_snapshot,
        "rules_version": run.rules_version,
        "catalog_version": run.catalog_version,
        "measurement_schema_version": run.measurement_schema_version,
        "created_at": run.created_at,
    }


def create_recommendation(db: Session, payload: RecommendationCreate, idempotency_key: str) -> dict:
    if not idempotency_key.strip():
        raise DomainError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required")
    previous = get_recommendation_by_key(db, idempotency_key)
    if previous:
        if previous.session_id != payload.measurement_session_id:
            raise DomainError(409, "IDEMPOTENCY_KEY_CONFLICT", "This recommendation key is already in use")
        return _result_from_run(previous)

    session = get_session(db, payload.measurement_session_id)
    if not session:
        raise DomainError(404, "SESSION_NOT_FOUND", "Measurement session was not found")
    if session.status not in {"accepted", "flagged"} or not session.submission_idempotency_key:
        raise DomainError(409, "SESSION_NOT_SUBMITTED", "Submit the measurement session first")
    if not has_active_consent(db, session.participant_id, PURPOSE):
        raise DomainError(403, "CONSENT_REQUIRED", "Active recommendation consent is required")

    saved_status = session.status
    validation = validate_session(db, session.id)
    session.status = saved_status
    db.commit()
    if not validation["valid"]:
        raise DomainError(422, "MEASUREMENT_VALIDATION_FAILED", "The session has invalid measurements", validation["issues"])

    candidates = [g for g in GARMENTS if g["category"] == "shirt" and g["fabric"] not in payload.preferences.avoid_fabrics]
    if not candidates:
        raise DomainError(422, "NO_COMPATIBLE_GARMENT", "Every catalog fabric was excluded")
    ranked = rank_garments(candidates, payload.preferences)
    total, _, _, garment, breakdown, reasons = ranked[0]

    body = validation["normalized_measurements"]
    ease = EASE_PROFILES[payload.preferences.fit]
    finished = {code: value + ease.get(code, 0) for code, value in body.items()}
    warnings = [issue["message"] for issue in validation["issues"] if issue["level"] == "warning"]
    warnings.append("Ease allowances are provisional development values and require review by a qualified tailor.")
    result = {
        "garment_template": garment,
        "total_score": total,
        "score_breakdown": breakdown,
        "reasons": reasons,
        "warnings": warnings,
        "normalized_body_measurements": body,
        "target_finished_measurements": finished,
    }
    settings = get_settings()
    run = RecommendationRun(
        session_id=session.id,
        idempotency_key=idempotency_key,
        rules_version=settings.rules_version,
        catalog_version=settings.catalog_version,
        measurement_schema_version=settings.measurement_schema_version,
        input_snapshot={
            "measurement_session_id": str(session.id),
            "measurements_mm": body,
            "preferences": payload.preferences.model_dump(),
        },
        result_snapshot=result,
        score_breakdown=breakdown,
    )
    db.add(run)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        previous = get_recommendation_by_key(db, idempotency_key)
        if previous:
            return _result_from_run(previous)
        raise DomainError(409, "IDEMPOTENCY_KEY_CONFLICT", "This recommendation key is already in use") from exc
    db.refresh(run)
    return _result_from_run(run)


def get_recommendation(db: Session, recommendation_id: uuid.UUID) -> dict:
    run = db.get(RecommendationRun, recommendation_id)
    if not run:
        raise DomainError(404, "RECOMMENDATION_NOT_FOUND", "Recommendation was not found")
    return _result_from_run(run)
