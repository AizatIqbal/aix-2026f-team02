from decimal import Decimal

from fastapi.testclient import TestClient

from app import currency_routes
from app.main import app


def test_money_rounding_uses_currency_minor_units():
    assert currency_routes._round_amount(Decimal("12.345"), "MYR") == Decimal("12.35")
    assert currency_routes._round_amount(Decimal("12.6"), "KRW") == Decimal("13")


def test_reference_rate_parser_uses_frankfurter_response(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return [{
                "base": "KRW",
                "quote": "MYR",
                "date": "2026-11-23",
                "rate": 0.0028,
            }]

    captured = {}

    def fake_get(url, **kwargs):
        captured["url"] = url
        captured.update(kwargs)
        return FakeResponse()

    monkeypatch.setattr(currency_routes.httpx, "get", fake_get)
    rate, rate_date, provider = currency_routes._fetch_reference_rate("KRW", "MYR")

    assert rate == Decimal("0.0028")
    assert rate_date.isoformat() == "2026-11-23"
    assert provider == "Frankfurter"
    assert captured["params"] == {"base": "KRW", "quotes": "MYR"}
    assert captured["timeout"] == 8.0


def test_currency_change_requires_explicit_confirmation():
    client = TestClient(app)
    response = client.post("/api/v1/currency/change", json={"target_currency": "MYR"})
    assert response.status_code == 400
    assert "confirmation" in response.json()["detail"].lower()


def test_environment_endpoint_exposes_only_the_mode():
    client = TestClient(app)
    response = client.get("/api/v1/environment")
    assert response.status_code == 200
    assert response.json()["mode"] in {"development", "demo", "production"}
    assert response.json()["is_demo"] == (response.json()["mode"] == "demo")
    assert "database_url" not in response.json()


def test_initial_currency_setup_saves_currency_for_empty_workspace(monkeypatch):
    class FakeResult:
        def __init__(self, row=None, counts=None):
            self.row = row
            self.counts = counts

        def mappings(self):
            return self

        def first(self):
            return self.row

        def one(self):
            return self.counts

    class FakeConnection:
        def __init__(self):
            self.initialized = False
            self.currency = "KRW"

        def execute(self, statement, params=None):
            query = str(statement)
            if "SELECT operating_currency, currency_initialized" in query:
                return FakeResult({"operating_currency": self.currency, "currency_initialized": self.initialized})
            if "SELECT" in query and "COUNT(*)" in query:
                return FakeResult(counts={"products": 0, "orders": 0, "customers": 0, "campaigns": 0})
            if "UPDATE pointnull_settings" in query:
                self.currency = params["currency"]
                self.initialized = True
            return FakeResult()

    class FakeEngine:
        def __init__(self, connection):
            self.connection = connection

        def begin(self):
            from contextlib import nullcontext
            return nullcontext(self.connection)

    fake_connection = FakeConnection()

    class FakeDatabaseManager:
        def __init__(self):
            self.engine = FakeEngine(fake_connection)

        def close(self):
            return None

    monkeypatch.setattr(currency_routes, "DatabaseManager", FakeDatabaseManager)
    client = TestClient(app)
    response = client.post("/api/v1/currency/initialize", json={"currency": "MYR"})

    assert response.status_code == 200
    assert response.json() == {"currency": "MYR", "initialized": True, "changed": True}
    assert fake_connection.currency == "MYR"
    assert fake_connection.initialized is True


def test_initial_currency_setup_refuses_existing_business_data(monkeypatch):
    class FakeResult:
        def mappings(self):
            return self

        def first(self):
            return {"operating_currency": "KRW", "currency_initialized": False}

        def one(self):
            return {"products": 1, "orders": 0, "customers": 0, "campaigns": 0}

    class FakeConnection:
        def execute(self, statement, params=None):
            return FakeResult()

    class FakeEngine:
        def begin(self):
            from contextlib import nullcontext
            return nullcontext(FakeConnection())

    class FakeDatabaseManager:
        def __init__(self):
            self.engine = FakeEngine()

        def close(self):
            return None

    monkeypatch.setattr(currency_routes, "DatabaseManager", FakeDatabaseManager)
    client = TestClient(app)
    response = client.post("/api/v1/currency/initialize", json={"currency": "USD"})

    assert response.status_code == 409
    assert "empty workspace" in response.json()["detail"] or "business data" in response.json()["detail"]
