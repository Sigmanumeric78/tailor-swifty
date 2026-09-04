import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ContractModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, allow_inf_nan=False)


class ParticipantCreate(ContractModel):
    pass


class ParticipantResponse(ContractModel):
    id: uuid.UUID
    public_code: str
    status: str
    created_at: datetime


class ConsentStart(ContractModel):
    participant_id: uuid.UUID
    purpose: Literal["generate_outfit_recommendation"] = "generate_outfit_recommendation"
    granted: bool


class ConsentResponse(ContractModel):
    id: uuid.UUID
    participant_id: uuid.UUID
    consent_version: str
    purpose: str
    granted: bool
    granted_at: datetime | None


class MeasurementDefinition(ContractModel):
    code: str
    label: str
    kind: str
    instruction: str
    required_for: list[str]
    repeat_required: bool
    warning_min_mm: int
    warning_max_mm: int
    measurement_schema_version: str


class MeasurementSchemaResponse(ContractModel):
    garment: str
    version: str
    range_notice: str
    fields: list[MeasurementDefinition]


class MeasurementSessionCreate(ContractModel):
    participant_id: uuid.UUID
    age_months_at_measurement: int = Field(ge=216, le=1440)
    garment_categories: list[Literal["shirt"]] = Field(min_length=1, max_length=1)
    measurement_method: Literal["self", "assisted", "professional"] = "self"
    unit_entered: Literal["cm", "in"]


class MeasurementSessionResponse(ContractModel):
    id: uuid.UUID
    participant_id: uuid.UUID
    age_months_at_measurement: int
    garment_categories: list[str]
    measurement_method: str
    unit_entered: str
    protocol_version: str
    measurement_schema_version: str
    status: str
    quality_score: int | None
    created_at: datetime


class MeasurementAttempt(ContractModel):
    measurement_code: str = Field(min_length=1, max_length=64)
    value: Decimal = Field(gt=0)
    unit: Literal["cm", "in"]
    attempt_number: int = Field(ge=1, le=3)
    confidence: int | None = Field(default=None, ge=1, le=5)


class MeasurementBatch(ContractModel):
    measurements: list[MeasurementAttempt] = Field(min_length=1, max_length=24)


class MeasurementValueResponse(ContractModel):
    id: uuid.UUID
    measurement_code: str
    value_mm: int
    attempt_number: int
    confidence: int | None
    validation_status: str


class Issue(ContractModel):
    level: Literal["error", "warning", "information"]
    code: str
    field: str | None = None
    message: str


class ValidationResponse(ContractModel):
    valid: bool
    status: str
    quality_score: int
    normalized_measurements: dict[str, int]
    issues: list[Issue]


class Preferences(ContractModel):
    occasion: Literal["office", "smart-casual", "casual", "travel"]
    climate: Literal["hot", "humid", "mild", "cool"]
    fit: Literal["slim", "regular", "relaxed"]
    styles: list[str] = Field(default_factory=list, max_length=5)
    colours: list[str] = Field(default_factory=list, max_length=5)
    preferred_fabrics: list[str] = Field(default_factory=list, max_length=5)
    avoid_fabrics: list[str] = Field(default_factory=list, max_length=5)


class RecommendationCreate(ContractModel):
    measurement_session_id: uuid.UUID
    preferences: Preferences


class RecommendationResponse(ContractModel):
    id: uuid.UUID
    measurement_session_id: uuid.UUID
    garment_template: dict
    total_score: int
    score_breakdown: dict[str, int]
    reasons: list[str]
    warnings: list[str]
    normalized_body_measurements: dict[str, int]
    target_finished_measurements: dict[str, int]
    rules_version: str
    catalog_version: str
    measurement_schema_version: str
    created_at: datetime

