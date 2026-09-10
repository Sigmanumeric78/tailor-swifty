from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "postgresql+psycopg://tailor_app:replace_me@localhost:5432/tailor_db"
    database_url_parameter_name: str | None = None
    consent_version: str = "1"
    measurement_schema_version: str = "1"
    protocol_version: str = "1"
    rules_version: str = "1"
    catalog_version: str = "1"
    repeat_tolerance_mm: int = 10
    allowed_origins: str = "http://127.0.0.1:5173,http://localhost:5173"
    camera_processing_signing_parameter_name: str | None = None
    camera_processing_consent_version: str = "server-camera-consent-1"
    participant_access_ttl_seconds: int = 1800

    @property
    def allowed_origin_list(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.allowed_origins.split(",")
            if origin.strip()
        ]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()


def get_database_url() -> str:
    settings = get_settings()

    # Local development and tests continue using DATABASE_URL.
    if not settings.database_url_parameter_name:
        return settings.database_url

    # Lambda retrieves and decrypts the SecureString during cold start.
    import boto3

    response = boto3.client("ssm").get_parameter(
        Name=settings.database_url_parameter_name,
        WithDecryption=True,
    )
    return str(response["Parameter"]["Value"])


@lru_cache
def get_camera_processing_signing_secret() -> bytes:
    """Resolve the dedicated HMAC key without exposing it to responses or logs."""
    parameter_name = get_settings().camera_processing_signing_parameter_name
    if not parameter_name:
        raise RuntimeError("CAMERA_PROCESSING_SIGNING_PARAMETER_NAME is required")
    import boto3

    response = boto3.client("ssm").get_parameter(Name=parameter_name, WithDecryption=True)
    value = str(response["Parameter"]["Value"])
    if len(value.encode("utf-8")) < 32:
        raise RuntimeError("Camera processing signing secret is too short")
    return value.encode("utf-8")
