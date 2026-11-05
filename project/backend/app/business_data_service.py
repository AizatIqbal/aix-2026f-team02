"""Application service for sales analytics and product recommendations."""

from decimal import Decimal
from typing import Protocol

from .analytics import Filters, analyze
from .recommendations import discount_suggestions, recommend_products


class BusinessDataHandler(Protocol):
    """Data access contract required by the business data service."""

    def get_analysis_records(self) -> dict:
        """Return products, customers, campaigns, orders and order items."""
        ...


class BusinessDataService:
    """Coordinates data retrieval and business analysis."""

    def __init__(self, data_handler: BusinessDataHandler):
        self.data_handler = data_handler

    def get_statistics(self, filters: Filters) -> dict:
        return analyze(self.data_handler.get_analysis_records(), filters)

    def get_recommendations(self, customer_phone: str) -> dict:
        return recommend_products(
            self.data_handler.get_analysis_records(), customer_phone
        )

    def get_discount_suggestion(
        self, filters: Filters, product_id: int, unit_cost: Decimal
    ) -> dict:
        result = discount_suggestions(
            self.data_handler.get_analysis_records(), filters, {product_id: unit_cost}
        )
        return {
            "item": next(
                (item for item in result["items"] if item["product_id"] == product_id),
                None,
            ),
            "minimum_margin": result["minimum_margin"],
        }
