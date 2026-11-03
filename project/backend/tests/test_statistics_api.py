"""HTTP validation/lifecycle tests; no running MySQL server is needed."""

from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from mysql.connector import Error as MySQLError

from app.business_data_service import BusinessDataService
from app.main import app
from app.statistics_routes import get_business_data_service


URL = "/api/v1/statistics?start=2026-11-01&end=2026-11-02"


class RecordingService:
    def __init__(self, error=None):
        self.filters = None
        self.error = error

    def get_statistics(self, filters):
        self.filters = filters
        if self.error is not None:
            raise self.error
        return {"summary": {"units": 48, "gross": "95064.00",
                            "discount": "14259.60", "net": "80804.40"},
                "group": filters.group, "warnings": []}


@pytest.fixture
def service():
    service = RecordingService()
    app.dependency_overrides[get_business_data_service] = lambda: service
    try:
        yield service
    finally:
        app.dependency_overrides.pop(get_business_data_service, None)


def test_statistics_endpoint_passes_parsed_dates_to_service(service):
    with TestClient(app) as client:
        response = client.get(URL)
    assert response.status_code == 200
    assert response.json()["summary"]["net"] == "80804.40"
    assert service.filters.start == date(2026, 11, 1)
    assert service.filters.end == date(2026, 11, 2)
    assert service.filters.group == "day"


@pytest.mark.parametrize("group", ["day", "week", "month", "year"])
def test_period_grouping_is_supported(service, group):
    with TestClient(app) as client:
        response = client.get(URL + "&group=" + group)
    assert response.status_code == 200
    assert service.filters.group == group


@pytest.mark.parametrize("query", [
    "start=not-a-date&end=2026-11-02",
    "start=2026-11-03&end=2026-11-01",
    "start=2000-01-01&end=2026-11-01",
    "start=2026-11-01&end=2026-11-02&group=hour",
    "start=2026-11-01",
])
def test_invalid_requests_do_not_run_analytics(service, query):
    with TestClient(app) as client:
        response = client.get("/api/v1/statistics?" + query)
    assert response.status_code == 422
    assert service.filters is None


def test_database_error_does_not_expose_connection_details(service):
    service.error = MySQLError("Access denied; secret-placeholder")
    with TestClient(app) as client:
        response = client.get(URL)
    assert response.status_code == 503
    assert "secret-placeholder" not in response.text


def test_invalid_stored_data_returns_an_error(service):
    service.error = ValueError("Invalid stored discount")
    with TestClient(app) as client:
        response = client.get(URL)
    assert response.status_code == 409


def test_health_is_independent_of_database_configuration(monkeypatch):
    monkeypatch.delenv("MYSQL_USER", raising=False)
    monkeypatch.delenv("MYSQL_PASSWORD", raising=False)
    with TestClient(app) as client:
        assert client.get("/api/v1/health").json() == {"status": "ok"}
        assert client.get(URL).status_code == 503


def test_dependency_closes_manager_when_request_finishes(monkeypatch):
    monkeypatch.setenv("MYSQL_USER", "test-user")
    monkeypatch.setenv("MYSQL_PASSWORD", "test-password")
    monkeypatch.setenv("MYSQL_HOST", "127.0.0.1")
    monkeypatch.setenv("MYSQL_PORT", "3306")
    monkeypatch.setenv("MYSQL_DATABASE", "pos_database_mysql")
    with patch("app.statistics_routes.DatabaseManager") as manager:
        dependency = get_business_data_service()
        assert isinstance(next(dependency), BusinessDataService)
        manager.return_value.close.assert_not_called()
        dependency.close()
        manager.return_value.close.assert_called_once()
        manager.assert_called_once_with(
            user="test-user", password="test-password", host="127.0.0.1",
            port=3306, database="pos_database_mysql",
        )


def test_dependency_closes_manager_when_request_fails(monkeypatch):
    monkeypatch.setenv("MYSQL_USER", "test-user")
    monkeypatch.setenv("MYSQL_PASSWORD", "test-password")
    with patch("app.statistics_routes.DatabaseManager") as manager:
        dependency = get_business_data_service()
        next(dependency)
        with pytest.raises(RuntimeError):
            dependency.throw(RuntimeError("request failed"))
        manager.return_value.close.assert_called_once()


@pytest.mark.parametrize("port", ["invalid", "0", "65536"])
def test_invalid_server_port_is_reported(monkeypatch, port):
    monkeypatch.setenv("MYSQL_USER", "test-user")
    monkeypatch.setenv("MYSQL_PASSWORD", "test-password")
    monkeypatch.setenv("MYSQL_PORT", port)
    with TestClient(app) as client:
        response = client.get(URL)
    assert response.status_code == 503
    assert "MYSQL_PORT" in response.json()["detail"]


def test_http_request_uses_data_handler_service_and_connection_cleanup(monkeypatch):
    monkeypatch.setenv("MYSQL_USER", "test-user")
    monkeypatch.setenv("MYSQL_PASSWORD", "test-password")
    db = MagicMock()
    db.fetch_all.side_effect = [
        [{"product_id": 1, "category_id": 1, "product_name": "Cola", "price": "1980.50"}],
        [],
        [{"order_id": 1, "customer_phone": None, "order_date": date(2026, 11, 1),
          "order_time": "17:30:00", "discount": "15%", "total": "80804.40"}],
        [{"order_item_id": 1, "order_id": 1, "product_id": 1, "quantity": 48,
          "price": "1980.50"}],
    ]
    with patch("app.statistics_routes.DatabaseManager", return_value=db):
        with TestClient(app) as client:
            response = client.get(URL)
    assert response.status_code == 200
    assert response.json()["summary"]["units"] == 48
    assert response.json()["summary"]["net"] == "80804.40"
    assert response.json()["warnings"] == []
    assert db.fetch_all.call_count == 4
    db.close.assert_called_once()
