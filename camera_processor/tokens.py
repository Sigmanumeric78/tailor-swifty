"""Compact HMAC tokens shared by camera processor operations."""

import base64
import hashlib
import hmac
import json
import time
from typing import Any


TOKEN_SCHEMA_VERSION = "1"
PIPELINE_VERSION = "server-camera-0.1.0"
OBSERVATION_TTL_SECONDS = 600
CAMERA_SESSION = "CAMERA_SESSION"
FRONT_OBSERVATION = "FRONT_OBSERVATION"
SIDE_OBSERVATION = "SIDE_OBSERVATION"


class TokenError(ValueError):
    """A token is malformed, altered, expired, or inappropriate for the operation."""


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except Exception as exc:
        raise TokenError("TOKEN_INVALID") from exc


def canonical_json(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def sign_payload(payload: dict[str, Any], secret: bytes) -> str:
    encoded = _encode(canonical_json(payload))
    signature = _encode(hmac.new(secret, encoded.encode("ascii"), hashlib.sha256).digest())
    return f"{encoded}.{signature}"


def verify_token(
    token: str,
    secret: bytes,
    *,
    expected_type: str,
    now: int | None = None,
) -> dict[str, Any]:
    if not isinstance(token, str) or len(token) > 16_384 or token.count(".") != 1:
        raise TokenError("TOKEN_INVALID")
    encoded, supplied = token.split(".", 1)
    expected = _encode(hmac.new(secret, encoded.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(supplied, expected):
        raise TokenError("TOKEN_TAMPERED")
    try:
        payload = json.loads(_decode(encoded))
    except (json.JSONDecodeError, UnicodeDecodeError, TokenError) as exc:
        raise TokenError("TOKEN_INVALID") from exc
    current = int(time.time() if now is None else now)
    if payload.get("schema_version") != TOKEN_SCHEMA_VERSION:
        raise TokenError("TOKEN_VERSION_MISMATCH")
    if payload.get("token_type") != expected_type:
        raise TokenError("TOKEN_TYPE_MISMATCH")
    if payload.get("pipeline_version") != PIPELINE_VERSION:
        raise TokenError("TOKEN_VERSION_MISMATCH")
    if not isinstance(payload.get("exp"), int) or payload["exp"] < current:
        raise TokenError("TOKEN_EXPIRED")
    if not isinstance(payload.get("iat"), int) or payload["iat"] > current + 60:
        raise TokenError("TOKEN_INVALID")
    if not isinstance(payload.get("nonce"), str) or not payload["nonce"]:
        raise TokenError("TOKEN_INVALID")
    return payload


def observation_token(
    session: dict[str, Any],
    view: str,
    geometry: dict[str, Any],
    secret: bytes,
    *,
    now: int | None = None,
) -> tuple[str, int]:
    issued_at = int(time.time() if now is None else now)
    expires_at = min(issued_at + OBSERVATION_TTL_SECONDS, int(session["exp"]) + OBSERVATION_TTL_SECONDS)
    payload = {
        "exp": expires_at,
        "geometry": geometry,
        "iat": issued_at,
        "nonce": _encode(hashlib.sha256(f"{session['nonce']}:{view}:{issued_at}:{geometry}".encode()).digest()[:12]),
        "pipeline_version": PIPELINE_VERSION,
        "schema_version": TOKEN_SCHEMA_VERSION,
        "session_nonce": session["nonce"],
        "token_type": FRONT_OBSERVATION if view == "FRONT" else SIDE_OBSERVATION,
        "view": view,
    }
    return sign_payload(payload, secret), expires_at
