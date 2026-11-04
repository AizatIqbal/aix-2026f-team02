"""Application service for sales analytics and product recommendations."""

from typing import Protocol

from .analytics import Filters, analyze
from .recommendations import recommend_products


class BusinessDataHandler(Protocol):
    """Data access contract required by the business data service."""

    def get_analysis_records(self) -> dict:
        """Return products, customers, orders and order items in normalized form."""
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
