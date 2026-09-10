"""Issue and validate short-lived participant-bound access tokens."""

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import time
import uuid
from typing import Any

from app.core.config import get_camera_processing_signing_secret, get_settings
from app.core.errors import DomainError


TOKEN_SCHEMA_VERSION = "1"
PARTICIPANT_ACCESS = "PARTICIPANT_ACCESS"
CAMERA_SESSION = "CAMERA_SESSION"
FRONT_OBSERVATION = "FRONT_OBSERVATION"
SIDE_OBSERVATION = "SIDE_OBSERVATION"


class AccessTokenError(ValueError):
    """A participant access token is invalid or unsuitable for this request."""


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.b64decode(value + padding, altchars=b"-_", validate=True)
    except (ValueError, binascii.Error) as exc:
        raise AccessTokenError("TOKEN_INVALID") from exc


def canonical_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def sign_payload(payload: dict[str, Any], secret: bytes) -> str:
    encoded = _encode(canonical_json(payload))
    signature = _encode(hmac.new(secret, encoded.encode("ascii"), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


def verify_payload(
    token: str,
    secret: bytes,
    *,
    expected_type: str,
    now: int | None = None,
) -> dict[str, Any]:
    if not isinstance(token, str) or len(token) > 16_384 or token.count(".") != 1:
        raise AccessTokenError("TOKEN_INVALID")
    encoded, supplied_signature = token.split(".", 1)
    expected_signature = _encode(hmac.new(secret, encoded.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise AccessTokenError("TOKEN_TAMPERED")
    try:
        payload = json.loads(_decode(encoded))
    except (json.JSONDecodeError, UnicodeDecodeError, AccessTokenError) as exc:
        raise AccessTokenError("TOKEN_INVALID") from exc
    current = int(time.time() if now is None else now)
    if not isinstance(payload, dict) or payload.get("schema_version") != TOKEN_SCHEMA_VERSION:
        raise AccessTokenError("TOKEN_VERSION_MISMATCH")
    if payload.get("token_type") != expected_type:
        raise AccessTokenError("TOKEN_TYPE_MISMATCH")
    if not isinstance(payload.get("exp"), int) or payload["exp"] <= current:
        raise AccessTokenError("TOKEN_EXPIRED")
    if not isinstance(payload.get("iat"), int) or payload["iat"] > current + 60:
        raise AccessTokenError("TOKEN_INVALID")
    if not isinstance(payload.get("nonce"), str) or not payload["nonce"]:
        raise AccessTokenError("TOKEN_INVALID")
    return payload


def issue_participant_access_token(
    participant_id: uuid.UUID,
    *,
    now: int | None = None,
    secret: bytes | None = None,
) -> tuple[str, int]:
    issued_at = int(time.time() if now is None else now)
    expires_at = issued_at + get_settings().participant_access_ttl_seconds
    payload = {
        "exp": expires_at,
        "iat": issued_at,
        "nonce": secrets.token_urlsafe(18),
        "participant_id": str(participant_id),
        "schema_version": TOKEN_SCHEMA_VERSION,
        "token_type": PARTICIPANT_ACCESS,
    }
    return sign_payload(payload, secret or get_camera_processing_signing_secret()), expires_at


def participant_from_authorization(
    authorization: str | None,
    *,
    expected_participant_id: uuid.UUID | None = None,
    now: int | None = None,
    secret: bytes | None = None,
) -> uuid.UUID:
    if not authorization or not authorization.startswith("Bearer "):
        raise DomainError(401, "PARTICIPANT_ACCESS_REQUIRED", "A participant access token is required")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = verify_payload(
            token,
            secret or get_camera_processing_signing_secret(),
            expected_type=PARTICIPANT_ACCESS,
            now=now,
        )
        participant_id = uuid.UUID(str(payload.get("participant_id")))
    except (AccessTokenError, TypeError, ValueError) as exc:
        code = str(exc) if isinstance(exc, AccessTokenError) else "TOKEN_INVALID"
        raise DomainError(401, code, "The participant access token is expired or invalid") from exc
    if expected_participant_id is not None and participant_id != expected_participant_id:
        raise DomainError(403, "PARTICIPANT_ACCESS_MISMATCH", "The access token does not authorize this participant")
    return participant_id
