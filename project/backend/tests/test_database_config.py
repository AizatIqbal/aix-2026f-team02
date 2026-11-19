import pytest

from app.db import database_manager


def test_supabase_postgresql_url_uses_psycopg_and_tls():
    url = database_manager._build_database_url(
        "postgresql://postgres.projectref:secret@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"
    )

    assert url.drivername == "postgresql+psycopg"
    assert url.host == "aws-0-ap-northeast-1.pooler.supabase.com"
    assert url.port == 6543
    assert url.database == "postgres"
    assert url.query["sslmode"] == "require"


def test_existing_sslmode_is_preserved():
    url = database_manager._build_database_url(
        "postgresql://user:secret@db.example.test:5432/postgres?sslmode=verify-full"
    )
    assert url.query["sslmode"] == "verify-full"


def test_mysql_url_is_rejected_after_postgresql_migration():
    with pytest.raises(RuntimeError, match="must use PostgreSQL"):
        database_manager._build_database_url(
            "mysql+pymysql://root:secret@localhost:3306/business_management"
        )


def test_database_manager_requires_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="DATABASE_URL is missing"):
        database_manager.DatabaseManager()
