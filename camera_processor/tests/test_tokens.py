import pytest

from tokens import CAMERA_SESSION, FRONT_OBSERVATION, PIPELINE_VERSION, TokenError, observation_token, sign_payload, verify_token


SECRET = b"processor-test-secret-with-at-least-thirty-two-bytes"


def session(now=1_000, nonce="session-a"):
    payload = {"allowed_view_count": 6, "exp": now + 300, "iat": now, "nonce": nonce, "pipeline_version": PIPELINE_VERSION, "schema_version": "1", "token_type": CAMERA_SESSION, "view": "SESSION"}
    return sign_payload(payload, SECRET), payload


def test_token_tampering_expiry_and_type_are_rejected():
    token, _ = session()
    with pytest.raises(TokenError, match="TOKEN_TAMPERED"):
        verify_token(token[:-1] + ("A" if token[-1] != "A" else "B"), SECRET, expected_type=CAMERA_SESSION, now=1_001)
    with pytest.raises(TokenError, match="TOKEN_EXPIRED"):
        verify_token(token, SECRET, expected_type=CAMERA_SESSION, now=1_301)
    with pytest.raises(TokenError, match="TOKEN_TYPE_MISMATCH"):
        verify_token(token, SECRET, expected_type=FRONT_OBSERVATION, now=1_001)


def test_observation_contains_only_compact_geometry_and_session_binding():
    _, payload = session(); geometry = {"widths_mm": {"chest": 400.0}, "quality_score": 0.8, "warnings": []}
    token, expires = observation_token(payload, "FRONT", geometry, SECRET, now=1_001)
    decoded = verify_token(token, SECRET, expected_type=FRONT_OBSERVATION, now=1_002)
    assert decoded["session_nonce"] == "session-a"
    assert decoded["view"] == "FRONT"
    assert expires == 1_601
    assert not any(key in decoded for key in ["image", "base64", "mask", "contour", "landmarks", "filename", "exif"])
