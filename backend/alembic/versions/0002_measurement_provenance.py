"""Add privacy-safe measurement-session provenance."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_measurement_provenance"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None
JsonType = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.add_column("measurement_sessions", sa.Column("input_mode", sa.String(length=32), server_default="MANUAL_MEASUREMENTS", nullable=False))
    op.add_column("measurement_sessions", sa.Column("capture_source", sa.String(length=24), server_default="manual", nullable=False))
    op.add_column("measurement_sessions", sa.Column("calibration_mode", sa.String(length=32), server_default="UNAVAILABLE", nullable=False))
    op.add_column("measurement_sessions", sa.Column("confidence_version", sa.String(length=48), nullable=True))
    op.add_column("measurement_sessions", sa.Column("model_versions", JsonType, server_default=sa.text("'[]'"), nullable=False))
    op.add_column("measurement_sessions", sa.Column("reason_codes", JsonType, server_default=sa.text("'[]'"), nullable=False))
    op.add_column("measurement_sessions", sa.Column("device_capability_summary", JsonType, nullable=True))
    op.add_column("measurement_sessions", sa.Column("manually_reviewed", sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    for column in ["manually_reviewed", "device_capability_summary", "reason_codes", "model_versions", "confidence_version", "calibration_mode", "capture_source", "input_mode"]:
        op.drop_column("measurement_sessions", column)
