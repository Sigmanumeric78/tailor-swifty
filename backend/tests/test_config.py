import sys
from types import SimpleNamespace

from app.core import config


def test_database_url_uses_local_setting_without_ssm(monkeypatch):
    settings = SimpleNamespace(
        database_url="local-database-url",
        database_url_parameter_name=None,
    )
    monkeypatch.setattr(config, "get_settings", lambda: settings)

    assert config.get_database_url() == "local-database-url"


def test_database_url_reads_named_ssm_parameter_with_decryption(monkeypatch):
    settings = SimpleNamespace(
        database_url="unused-local-url",
        database_url_parameter_name="/application/production/database-url",
    )
    calls = []

    class FakeSsmClient:
        def get_parameter(self, **kwargs):
            calls.append(kwargs)
            return {"Parameter": {"Value": "resolved-database-url"}}

    fake_boto3 = SimpleNamespace(client=lambda service: FakeSsmClient() if service == "ssm" else None)
    monkeypatch.setattr(config, "get_settings", lambda: settings)
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)

    assert config.get_database_url() == "resolved-database-url"
    assert calls == [
        {
            "Name": "/application/production/database-url",
            "WithDecryption": True,
        }
    ]
