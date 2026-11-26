import pytest

from app.db import database_manager


def test_demo_mode_uses_its_own_database_and_never_falls_back(monkeypatch):
    monkeypatch.setattr(database_manager, "APP_ENV", "demo")
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:secret@prod.example.test:5432/postgres")
    monkeypatch.setenv("DEMO_DATABASE_URL", "postgresql://user:secret@demo.example.test:5432/postgres")
    assert "demo.example.test" in database_manager._selected_database_url()

    monkeypatch.delenv("DEMO_DATABASE_URL")
    with pytest.raises(RuntimeError, match="DEMO_DATABASE_URL is required"):
        database_manager._selected_database_url()


def test_demo_mode_rejects_same_database_target_as_production(monkeypatch):
    monkeypatch.setattr(database_manager, "APP_ENV", "demo")
    url = "postgresql://user:secret@db.example.test:5432/postgres"
    monkeypatch.setenv("DEMO_DATABASE_URL", url)
    monkeypatch.setenv("PRODUCTION_DATABASE_URL", url)
    with pytest.raises(RuntimeError, match="same host/database as production"):
        database_manager._selected_database_url()


def test_production_mode_prefers_production_database_url(monkeypatch):
    monkeypatch.setattr(database_manager, "APP_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:secret@legacy.example.test:5432/postgres")
    monkeypatch.setenv("PRODUCTION_DATABASE_URL", "postgresql://user:secret@prod.example.test:5432/postgres")
    assert "prod.example.test" in database_manager._selected_database_url()


def test_development_mode_preserves_existing_database_url(monkeypatch):
    monkeypatch.setattr(database_manager, "APP_ENV", "development")
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:secret@localhost:5432/pointnull")
    assert "localhost" in database_manager._selected_database_url()


def test_demo_storage_credentials_never_fall_back_to_production(monkeypatch):
    from app import main

    monkeypatch.setattr(main, "APP_ENV", "demo")
    monkeypatch.setenv("SUPABASE_URL", "https://production.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "production-secret")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_JWT", "production-jwt")
    monkeypatch.delenv("DEMO_SUPABASE_URL", raising=False)
    monkeypatch.delenv("DEMO_SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.delenv("DEMO_SUPABASE_SERVICE_ROLE_JWT", raising=False)

    url, secret, jwt, bucket = main._supabase_storage_settings()
    assert url == ""
    assert secret == ""
    assert jwt == ""
    assert bucket == "product-images"


def test_production_storage_can_use_legacy_settings(monkeypatch):
    from app import main

    monkeypatch.setattr(main, "APP_ENV", "production")
    monkeypatch.setenv("SUPABASE_URL", "https://production.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "production-secret")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_JWT", "production-jwt")
    monkeypatch.delenv("PRODUCTION_SUPABASE_URL", raising=False)
    monkeypatch.delenv("PRODUCTION_SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.delenv("PRODUCTION_SUPABASE_SERVICE_ROLE_JWT", raising=False)

    url, secret, jwt, _bucket = main._supabase_storage_settings()
    assert url == "https://production.supabase.co"
    assert secret == "production-secret"
    assert jwt == "production-jwt"
