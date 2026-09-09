import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

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


SafeCode = Annotated[str, Field(min_length=1, max_length=96, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")]


class DeviceCapabilitySummary(ContractModel):
    width: int | None = Field(default=None, ge=1, le=20000)
    height: int | None = Field(default=None, ge=1, le=20000)
    frame_rate: float | None = Field(default=None, ge=0, le=1000)
    aspect_ratio: float | None = Field(default=None, gt=0, le=100)
    facing_mode: Literal["environment", "user", "left", "right"] | None = None
    resize_mode: Literal["none", "crop-and-scale"] | None = None
    zoom: float | None = Field(default=None, gt=0, le=100)
    torch_available: bool | None = None


class MeasurementSessionCreate(ContractModel):
    model_config = ConfigDict(from_attributes=True, allow_inf_nan=False, extra="forbid")
    participant_id: uuid.UUID
    age_months_at_measurement: int = Field(ge=216, le=1440)
    garment_categories: list[Literal["shirt"]] = Field(min_length=1, max_length=1)
    measurement_method: Literal["self", "assisted", "professional"] = "self"
    unit_entered: Literal["cm", "in"]
    input_mode: Literal["MANUAL_MEASUREMENTS", "CAMERA_MEASUREMENTS", "HEIGHT_WEIGHT_SIZE_ESTIMATE"] = "MANUAL_MEASUREMENTS"
    capture_source: Literal["manual", "live_camera", "photo_import", "height_weight"] = "manual"
    calibration_mode: Literal["VERIFIED_HEIGHT", "PHYSICAL_REFERENCE", "NATIVE_INTRINSICS_DEPTH", "UNAVAILABLE"] = "UNAVAILABLE"
    confidence_version: str | None = Field(default=None, min_length=1, max_length=48, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    model_versions: list[SafeCode] = Field(default_factory=list, max_length=12)
    reason_codes: list[SafeCode] = Field(default_factory=list, max_length=64)
    device_capability_summary: DeviceCapabilitySummary | None = None
    manually_reviewed: bool = False


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
    input_mode: str
    capture_source: str
    calibration_mode: str
    confidence_version: str | None
    model_versions: list[str]
    reason_codes: list[str]
    device_capability_summary: DeviceCapabilitySummary | None
    manually_reviewed: bool


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
