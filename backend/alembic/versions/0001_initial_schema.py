"""Create the adult shirt vertical-slice schema."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "participants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("public_code", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_participants_public_code", "participants", ["public_code"], unique=True)
    op.create_index("ix_participants_status", "participants", ["status"], unique=False)

    op.create_table(
        "consent_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("participant_id", sa.Uuid(), nullable=False),
        sa.Column("consent_version", sa.String(length=32), nullable=False),
        sa.Column("purpose", sa.String(length=64), nullable=False),
        sa.Column("granted", sa.Boolean(), nullable=False),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["participant_id"], ["participants.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_consent_records_participant_id", "consent_records", ["participant_id"], unique=False)
    op.create_index("ix_consent_participant_purpose_granted", "consent_records", ["participant_id", "purpose", "granted"], unique=False)

    op.create_table(
        "measurement_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("participant_id", sa.Uuid(), nullable=False),
        sa.Column("age_months_at_measurement", sa.Integer(), nullable=False),
        sa.Column("garment_categories", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("measurement_method", sa.String(length=32), nullable=False),
        sa.Column("unit_entered", sa.String(length=8), nullable=False),
        sa.Column("protocol_version", sa.String(length=32), nullable=False),
        sa.Column("measurement_schema_version", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("quality_score", sa.Integer(), nullable=True),
        sa.Column("submission_idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["participant_id"], ["participants.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("submission_idempotency_key", name="uq_session_submission_idempotency_key"),
    )
    op.create_index("ix_measurement_sessions_participant_id", "measurement_sessions", ["participant_id"], unique=False)
    op.create_index("ix_measurement_sessions_status", "measurement_sessions", ["status"], unique=False)
    op.create_index("ix_session_participant_created", "measurement_sessions", ["participant_id", "created_at"], unique=False)

    op.create_table(
        "measurement_values",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("measurement_code", sa.String(length=64), nullable=False),
        sa.Column("value_mm", sa.Integer(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("confidence", sa.Integer(), nullable=True),
        sa.Column("validation_status", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["measurement_sessions.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_id", "measurement_code", "attempt_number", name="uq_measurement_attempt"),
    )
    op.create_index("ix_measurement_values_session_id", "measurement_values", ["session_id"], unique=False)
    op.create_index("ix_measurement_code_value", "measurement_values", ["measurement_code", "value_mm"], unique=False)

    op.create_table(
        "recommendation_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("rules_version", sa.String(length=32), nullable=False),
        sa.Column("catalog_version", sa.String(length=32), nullable=False),
        sa.Column("measurement_schema_version", sa.String(length=32), nullable=False),
        sa.Column("input_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("result_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("score_breakdown", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["measurement_sessions.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_index("ix_recommendation_runs_session_id", "recommendation_runs", ["session_id"], unique=False)


def downgrade() -> None:
    op.drop_table("recommendation_runs")
    op.drop_table("measurement_values")
    op.drop_table("measurement_sessions")
    op.drop_table("consent_records")
    op.drop_table("participants")

