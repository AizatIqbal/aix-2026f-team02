from typing import Protocol

from .analytics import Filters, analyze
from .recommendations import recommend_products


class BusinessDataHandler(Protocol):
    """The operations the service needs from the data layer."""

    def get_analysis_records(self) -> dict:
        ...


class BusinessDataService:
    """Coordinates data retrieval and analysis."""

    def __init__(self, data_handler: BusinessDataHandler):
        self.data_handler = data_handler

    def get_statistics(self, filters: Filters) -> dict:
        records = self.data_handler.get_analysis_records()
        return analyze(records, filters)

    def get_recommendations(self, customer_phone: str) -> dict:
        records = self.data_handler.get_analysis_records()
        return recommend_products(records, customer_phone)