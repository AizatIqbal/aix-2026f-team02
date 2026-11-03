from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.statistics_routes import get_business_data_service


class RecordingService:
    def __init__(self):
        self.filters = None

    def get_statistics(self, filters):
        self.filters = filters
        return {
            "summary": {"units": 2, "gross": "20.00", "discount": "2.00", "net": "18.00"},
            "group": filters.group,
            "warnings": [],
        }

    def get_recommendations(self, customer_phone):
        return {"customer_phone": customer_phone, "items": [], "status": "insufficient_overlap"}


@pytest.fixture

def service():
    instance = RecordingService()
    app.dependency_overrides[get_business_data_service] = lambda: instance
    try:
        yield instance
    finally:
        app.dependency_overrides.pop(get_business_data_service, None)


def test_statistics_endpoint_passes_dates_and_group(service):
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/statistics?start=2026-11-01&end=2026-11-02&group=week"
        )
    assert response.status_code == 200
    assert response.json()["summary"]["net"] == "18.00"
    assert service.filters.start == date(2026, 11, 1)
    assert service.filters.end == date(2026, 11, 2)
    assert service.filters.group == "week"


def test_statistics_endpoint_accepts_repeatable_filters(service):
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/statistics?start=2026-11-01&end=2026-11-02"
            "&product_ids=1&product_ids=3&weekdays=0&weekdays=6"
        )
    assert response.status_code == 200
    assert service.filters.product_ids == (1, 3)
    assert service.filters.weekdays == (0, 6)


@pytest.mark.parametrize(
    "query",
    [
        "start=not-a-date&end=2026-11-02",
        "start=2026-11-03&end=2026-11-01",
        "start=2026-11-01&end=2026-11-02&group=hour",
        "start=2026-11-01",
        "start=2026-11-01&end=2026-11-02&weekdays=7",
        "start=2026-11-01&end=2026-11-02&product_ids=0",
    ],
)
def test_invalid_statistics_query_is_rejected_without_running_service(service, query):
    with TestClient(app) as client:
        response = client.get("/api/v1/statistics?" + query)
    assert response.status_code == 422
    assert service.filters is None


def test_recommendations_route_calls_service(service):
    with TestClient(app) as client:
        response = client.get("/api/v1/recommendations/010-0000-0000")
    assert response.status_code == 200
    assert response.json()["status"] == "insufficient_overlap"


def test_original_health_route_still_exists():
    with TestClient(app) as client:
        response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
