"""Application service for sales analytics and product recommendations."""

from datetime import date
from decimal import Decimal
from typing import Protocol

from .analytics import Filters, analyze, as_date
from .recommendations import discount_suggestions, recommend_products


class BusinessDataHandler(Protocol):
    """Data access contract required by the business data service."""

    def get_analysis_records(self) -> dict:
        """Return products, customers, campaigns, orders and order items."""
        ...


class BusinessDataService:
    """Coordinates data retrieval and business analysis.

    A handler may offer narrower, faster reads (get_period_records,
    get_recommendation_records, get_sales_date_range). When it does not, the
    service falls back to the full get_analysis_records snapshot.
    """

    def __init__(self, data_handler: BusinessDataHandler):
        self.data_handler = data_handler

    def _period_records(self, filters: Filters) -> dict:
        load = getattr(self.data_handler, "get_period_records", None)
        if load is None:
            return self.data_handler.get_analysis_records()
        return load(filters.start, filters.end)

    def get_sales_date_range(self) -> tuple[date, date] | None:
        """First and last order date, or None when nothing has been sold."""
        load = getattr(self.data_handler, "get_sales_date_range", None)
        if load is not None:
            return load()
        days = [as_date(order["order_date"]) for order in self.data_handler.get_analysis_records()["orders"]]
        return (min(days), max(days)) if days else None

    def get_statistics(self, filters: Filters) -> dict:
        return analyze(self._period_records(filters), filters)

    def get_recommendations(self, customer_phone: str) -> dict:
        load = getattr(self.data_handler, "get_recommendation_records", None)
        records = load() if load is not None else self.data_handler.get_analysis_records()
        return recommend_products(records, customer_phone)

    def get_discount_suggestion(
        self, filters: Filters, product_id: int, unit_cost: Decimal | None = None
    ) -> dict:
        """Suggest a discount for one product. unit_cost is optional."""
        costs = {} if unit_cost is None else {product_id: unit_cost}
        result = discount_suggestions(self._period_records(filters), filters, costs)
        return {
            "item": next(
                (item for item in result["items"] if item["product_id"] == product_id),
                None,
            ),
            "minimum_margin": result["minimum_margin"],
            "maximum_discount_fraction": result["maximum_discount_fraction"],
            "method": result["method"],
        }
