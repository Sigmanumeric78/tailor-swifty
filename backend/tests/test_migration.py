import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_provenance_migration_upgrades_and_downgrades_disposable_database(monkeypatch):
    path = Path(__file__).parents[1] / "alembic" / "versions" / "0002_measurement_provenance.py"
    spec = importlib.util.spec_from_file_location("provenance_migration", path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    engine = sa.create_engine("sqlite+pysqlite:///:memory:")
    expected = {"input_mode", "capture_source", "calibration_mode", "confidence_version", "model_versions", "reason_codes", "device_capability_summary", "manually_reviewed"}
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE measurement_sessions (id VARCHAR(36) PRIMARY KEY)"))
        monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(connection)))
        module.upgrade()
        assert expected.issubset({column["name"] for column in sa.inspect(connection).get_columns("measurement_sessions")})
        module.downgrade()
        assert {column["name"] for column in sa.inspect(connection).get_columns("measurement_sessions")} == {"id"}
    engine.dispose()
