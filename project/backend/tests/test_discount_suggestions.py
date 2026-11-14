from datetime import date
from decimal import Decimal

import pytest

from app.analytics import Filters
from app.business_data_service import BusinessDataService
from app.recommendations import (
    discount_suggestions,
    performance_discount_percent,
    sales_performance,
)

DAY = date(2026, 11, 1)
FILTERS = Filters(DAY, DAY)
# Units sold per product. The typical (median) selling product sold 100.
UNITS = {1: 0, 2: 40, 3: 80, 4: 95, 5: 100, 6: 110, 7: 150, 8: 200}


def snapshot(units=UNITS, price="100.00"):
    products = [
        {"product_id": product_id, "category_id": 1, "product_name": f"Product {product_id}", "price": price}
        for product_id in units
    ]
    sold = [(product_id, quantity) for product_id, quantity in units.items() if quantity]
    return {
        "products": products,
        "customers": [],
        "orders": [
            {
                "order_id": product_id,
                "order_date": DAY.isoformat(),
                "order_time": "10:00:00",
                "customer_phone": None,
                "discount": "0.00",
                "total": str(Decimal(price) * quantity),
            }
            for product_id, quantity in sold
        ],
        "orderItems": [
            {"order_item_id": product_id, "order_id": product_id, "product_id": product_id, "quantity": quantity, "price": price}
            for product_id, quantity in sold
        ],
    }


def suggestion(product_id, cost="40.00", **kwargs):
    result = discount_suggestions(snapshot(**kwargs), FILTERS, {product_id: Decimal(cost)})
    return next(item for item in result["items"] if item["product_id"] == product_id)


def test_weaker_sellers_get_larger_discounts():
    percents = {product_id: suggestion(product_id)["performance_discount_percent"] for product_id in UNITS}
    # 0 units and 40 units are both at least half below typical: full 20%.
    # 80 units is 20% below typical: 8%.  95 units is 5% below: 2%.
    assert percents == {1: 20, 2: 20, 3: 8, 4: 2, 5: 0, 6: 0, 7: 0, 8: 0}


@pytest.mark.parametrize(
    ("ratio", "expected"),
    [("0", 20), ("0.5", 20), ("0.6", 16), ("0.75", 10), ("0.9", 4), ("0.99", 0), ("1", 0), ("1.8", 0)],
)
def test_performance_curve(ratio, expected):
    assert performance_discount_percent(Decimal(ratio), Decimal("0.20")) == expected


def test_curve_scales_with_the_maximum_discount():
    assert performance_discount_percent(Decimal("0.75"), Decimal("0.30")) == 15
    assert performance_discount_percent(None, Decimal("0.20")) == 0


def test_performance_details_are_reported():
    item = suggestion(3)
    assert item["performance"] == {
        "rank": 6,
        "of": 8,
        "units": 80,
        "typical_units": 100.0,
        "percent_of_typical": 80,
    }


def test_typical_ignores_products_that_never_sold():
    products = [{"product_id": n, "units": units} for n, units in enumerate([0, 0, 0, 0, 10, 20, 30], 1)]
    standing = sales_performance(products)
    assert standing[5]["typical_units"] == 20.0
    assert standing[1]["ratio"] == 0 and standing[1]["rank"] == 4
    assert standing[6]["ratio"] == 1


def test_suggestion_within_margin_uses_the_performance_percentage():
    item = suggestion(3, cost="40.00")
    assert item["status"] == "trial_candidate"
    assert item["candidate_discount_percent"] == 8
    assert item["limited_by"] == "performance"
    assert item["discounted_unit_price"] == "92.00"
    assert item["contribution_per_unit"] == "52.00"
    assert item["required_unit_sales_multiplier"] == round(60 / 52, 3)


def test_margin_lowers_the_suggestion():
    # Price 100, cost 60, 30% margin: the price cannot go below 85.72, so 14% at most.
    item = suggestion(1, cost="60.00")
    assert item["performance_discount_percent"] == 20
    assert item["candidate_discount_percent"] == 14
    assert item["maximum_discount_percent"] == 14
    assert item["limited_by"] == "margin"
    assert item["discounted_unit_price"] == "86.00"
    assert (Decimal("86.00") - 60) / Decimal("86.00") >= Decimal("0.30")


def test_no_discount_when_cost_leaves_no_room():
    item = suggestion(1, cost="75.00")
    assert item["status"] == "no_discount_within_margin"
    assert item["candidate_discount_percent"] is None
    assert item["performance_discount_percent"] == 20


def test_products_at_or_above_typical_get_no_discount():
    for product_id in (5, 8):
        item = suggestion(product_id, cost="99.00")
        assert item["status"] == "selling_well"
        assert item["candidate_discount_percent"] == 0


def test_no_sales_and_single_product_selections():
    empty = discount_suggestions(snapshot(units={1: 0, 2: 0}), FILTERS, {1: Decimal("40")})
    assert {item["status"] for item in empty["items"]} == {"insufficient_sales_history"}
    alone = discount_suggestions(snapshot(units={1: 5}), FILTERS, {1: Decimal("40")})
    assert alone["items"][0]["status"] == "no_comparison"


def test_zero_price():
    assert suggestion(1, price="0.00")["status"] == "zero_price"
    result = discount_suggestions(snapshot(price="0.00"), FILTERS, {})
    assert result["items"][0]["status"] == "zero_price"


def test_suggestion_without_a_unit_cost_uses_sales_alone():
    result = discount_suggestions(snapshot(), FILTERS, {})
    items = {item["product_id"]: item for item in result["items"]}

    weak = items[3]  # 80% of typical
    assert weak["status"] == "trial_candidate"
    assert weak["candidate_discount_percent"] == weak["performance_discount_percent"] == 8
    assert weak["discounted_unit_price"] == "92.00"
    assert weak["candidate_discount_amount"] == "8.00"
    assert weak["margin_checked"] is False
    # Nothing that depends on a cost is reported.
    assert "contribution_per_unit" not in weak
    assert "maximum_discount_percent" not in weak

    assert items[1]["candidate_discount_percent"] == 20
    assert items[8]["status"] == "selling_well"


def test_unit_cost_turns_the_margin_check_on():
    without = suggestion(1, cost="60.00")
    assert without["margin_checked"] is True
    assert without["candidate_discount_percent"] == 14  # 20% from sales, capped by margin
    result = discount_suggestions(snapshot(), FILTERS, {})
    same_product = next(item for item in result["items"] if item["product_id"] == 1)
    assert same_product["candidate_discount_percent"] == 20


def test_service_returns_the_requested_product_and_the_method():
    class Handler:
        def get_analysis_records(self):
            return snapshot()

    service = BusinessDataService(Handler())
    result = service.get_discount_suggestion(FILTERS, 3, Decimal("40.00"))
    assert result["item"]["product_id"] == 3
    assert result["item"]["candidate_discount_percent"] == 8
    assert result["maximum_discount_fraction"] == "0.20"
    assert "typical" in result["method"]
    # A strong seller now gets an answer too, not an empty result.
    assert service.get_discount_suggestion(FILTERS, 8, Decimal("40.00"))["item"]["status"] == "selling_well"
    # The unit cost can be left out.
    no_cost = service.get_discount_suggestion(FILTERS, 3)["item"]
    assert (no_cost["candidate_discount_percent"], no_cost["margin_checked"]) == (8, False)
