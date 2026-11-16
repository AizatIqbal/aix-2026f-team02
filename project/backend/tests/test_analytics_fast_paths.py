"""The narrower reads used by /statistics and /recommendations must give the
same answers as the full snapshot they replace."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.analytics import Filters, analyze
from app.business_data_service import BusinessDataService
from app.db.business_data_handler import SQLAlchemyBusinessDataHandler
from app.main import app
from app.recommendations import recommend_products
from app.statistics_routes import get_business_data_service
from test_business_data_handler import (
    FakeDatabaseManager,
    make_engine_with_canonical_schema,
)

PHONES = ["010-0000-0000", "010-0000-0001", "010-0000-0002"]


def make_handler():
    """Seed order 1 (Nov 1, Kim, Coffee) plus products, customers and orders."""
    engine = make_engine_with_canonical_schema()
    with engine.begin() as connection:
        for statement in [
            "INSERT INTO product VALUES (2, 1, 'Latte', 12.00)",
            "INSERT INTO product VALUES (3, 1, 'Cake', 8.00)",
            "INSERT INTO customer VALUES ('010-0000-0001', 'Lee', 31, 'Male')",
            "INSERT INTO customer VALUES ('010-0000-0002', 'Park', NULL, NULL)",
            # order_id, date, time, phone, promocode, discount, total
            "INSERT INTO orders VALUES (2, '2026-11-03', '09:30:00', '010-0000-0001', NULL, 1.00, 29.00)",
            "INSERT INTO orders VALUES (3, '2026-11-03', '18:00:00', '010-0000-0002', NULL, 0, 30.00)",
            "INSERT INTO orders VALUES (4, '2026-11-09', '12:00:00', NULL, NULL, 0, 8.00)",
            "INSERT INTO orders VALUES (5, '2026-10-20', '12:00:00', '010-0000-0002', NULL, 0, 12.00)",
            # order_item_id, order_id, product_id, quantity, price
            "INSERT INTO order_item VALUES (2, 2, 1, 1, 10.00)",
            "INSERT INTO order_item VALUES (3, 2, 2, 1, 12.00)",
            "INSERT INTO order_item VALUES (4, 2, 3, 1, 8.00)",
            "INSERT INTO order_item VALUES (5, 3, 1, 3, 10.00)",
            "INSERT INTO order_item VALUES (6, 4, 3, 1, 8.00)",
            "INSERT INTO order_item VALUES (7, 5, 2, 1, 12.00)",
        ]:
            connection.execute(text(statement))
    return SQLAlchemyBusinessDataHandler(FakeDatabaseManager(engine))


def test_period_records_only_load_orders_in_range():
    handler = make_handler()
    records = handler.get_period_records(date(2026, 11, 1), date(2026, 11, 3))
    assert [order["order_id"] for order in records["orders"]] == [1, 2, 3]
    assert [item["order_item_id"] for item in records["orderItems"]] == [1, 2, 3, 4, 5]
    assert len(records["products"]) == 3


def test_statistics_match_the_full_snapshot():
    handler = make_handler()
    for filters in [
        Filters(date(2026, 11, 1), date(2026, 11, 3)),
        Filters(date(2026, 10, 1), date(2026, 11, 30), group="week"),
        Filters(date(2026, 11, 3), date(2026, 11, 9), product_ids=(1, 3)),
        Filters(date(2026, 12, 1), date(2026, 12, 2)),
    ]:
        fast = BusinessDataService(handler).get_statistics(filters)
        assert fast == analyze(handler.get_analysis_records(), filters)


def test_orders_are_counted_once_per_bucket():
    result = BusinessDataService(make_handler()).get_statistics(
        Filters(date(2026, 11, 1), date(2026, 11, 3))
    )
    assert result["summary"]["orders"] == 3
    assert result["summary"]["units"] == 8
    assert result["summary"]["discount"] == "3.00"
    assert result["summary"]["identified_orders"] == 3
    assert result["summary"]["known_age_orders"] == 2
    assert [(p["product_name"], p["units"], p["orders"]) for p in result["products"]] == [
        ("Coffee", 6, 3),
        ("Latte", 1, 1),
        ("Cake", 1, 1),
    ]
    assert [(p["period"], p["orders"]) for p in result["periods"]] == [
        ("2026-11-01", 1),
        ("2026-11-02", 0),
        ("2026-11-03", 2),
    ]


def test_recommendations_match_the_full_snapshot():
    handler = make_handler()
    full = handler.get_analysis_records()
    service = BusinessDataService(handler)
    for phone in PHONES:
        assert service.get_recommendations(phone) == recommend_products(full, phone)
    # Kim bought Coffee only; Lee and Park overlap on Coffee and both bought Latte.
    assert [item["product_name"] for item in service.get_recommendations(PHONES[0])["items"]] == ["Latte"]


def test_sales_date_range():
    handler = make_handler()
    assert handler.get_sales_date_range() == (date(2026, 10, 20), date(2026, 11, 9))
    with handler.db.engine.begin() as connection:
        connection.execute(text("DELETE FROM order_item"))
        connection.execute(text("DELETE FROM orders"))
    assert handler.get_sales_date_range() is None


class SnapshotHandler:
    """A handler with only the original full-snapshot method."""

    def __init__(self, records):
        self.records = records

    def get_analysis_records(self):
        return self.records


def test_statistics_without_dates_cover_all_sales():
    service = BusinessDataService(SnapshotHandler(make_handler().get_analysis_records()))
    app.dependency_overrides[get_business_data_service] = lambda: service
    try:
        with TestClient(app) as client:
            everything = client.get("/api/v1/statistics?group=month")
            half = client.get("/api/v1/statistics?end=2026-11-09")
    finally:
        app.dependency_overrides.pop(get_business_data_service, None)

    assert everything.status_code == 200
    body = everything.json()
    assert (body["start"], body["end"]) == ("2026-10-20", "2026-11-09")
    assert body["summary"]["orders"] == 5
    assert [period["period"] for period in body["periods"]] == ["2026-10", "2026-11"]
    assert half.status_code == 422
