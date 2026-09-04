from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "postgresql+psycopg://tailor_app:replace_me@localhost:5432/tailor_db"
    consent_version: str = "1"
    measurement_schema_version: str = "1"
    protocol_version: str = "1"
    rules_version: str = "1"
    catalog_version: str = "1"
    repeat_tolerance_mm: int = 10

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
