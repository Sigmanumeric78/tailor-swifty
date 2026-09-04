import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


JsonType = JSON().with_variant(JSONB, "postgresql")


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Participant(TimestampMixin, Base):
    __tablename__ = "participants"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    public_code: Mapped[str] = mapped_column(String(24), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)

    consents: Mapped[list["ConsentRecord"]] = relationship(back_populates="participant")
    sessions: Mapped[list["MeasurementSession"]] = relationship(back_populates="participant")


class ConsentRecord(Base):
    __tablename__ = "consent_records"
    __table_args__ = (
        Index("ix_consent_participant_purpose_granted", "participant_id", "purpose", "granted"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    participant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("participants.id", ondelete="RESTRICT"), index=True
    )
    consent_version: Mapped[str] = mapped_column(String(32))
    purpose: Mapped[str] = mapped_column(String(64))
    granted: Mapped[bool]
    granted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    participant: Mapped[Participant] = relationship(back_populates="consents")


class MeasurementSession(TimestampMixin, Base):
    __tablename__ = "measurement_sessions"
    __table_args__ = (
        Index("ix_session_participant_created", "participant_id", "created_at"),
        UniqueConstraint("submission_idempotency_key", name="uq_session_submission_idempotency_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    participant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("participants.id", ondelete="RESTRICT"), index=True
    )
    age_months_at_measurement: Mapped[int] = mapped_column(Integer)
    garment_categories: Mapped[list[str]] = mapped_column(JsonType)
    measurement_method: Mapped[str] = mapped_column(String(32))
    unit_entered: Mapped[str] = mapped_column(String(8))
    protocol_version: Mapped[str] = mapped_column(String(32))
    measurement_schema_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    quality_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    submission_idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)

    participant: Mapped[Participant] = relationship(back_populates="sessions")
    values: Mapped[list["MeasurementValue"]] = relationship(back_populates="session")
    recommendations: Mapped[list["RecommendationRun"]] = relationship(back_populates="session")


class MeasurementValue(Base):
    __tablename__ = "measurement_values"
    __table_args__ = (
        UniqueConstraint(
            "session_id", "measurement_code", "attempt_number", name="uq_measurement_attempt"
        ),
        Index("ix_measurement_code_value", "measurement_code", "value_mm"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("measurement_sessions.id", ondelete="RESTRICT"), index=True
    )
    measurement_code: Mapped[str] = mapped_column(String(64))
    value_mm: Mapped[int] = mapped_column(Integer)
    attempt_number: Mapped[int] = mapped_column(Integer)
    confidence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    validation_status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session: Mapped[MeasurementSession] = relationship(back_populates="values")


class RecommendationRun(Base):
    __tablename__ = "recommendation_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("measurement_sessions.id", ondelete="RESTRICT"), index=True
    )
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)
    rules_version: Mapped[str] = mapped_column(String(32))
    catalog_version: Mapped[str] = mapped_column(String(32))
    measurement_schema_version: Mapped[str] = mapped_column(String(32))
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JsonType)
    result_snapshot: Mapped[dict[str, Any]] = mapped_column(JsonType)
    score_breakdown: Mapped[dict[str, Any]] = mapped_column(JsonType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    session: Mapped[MeasurementSession] = relationship(back_populates="recommendations")

