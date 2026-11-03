import unittest
from datetime import date

from app.analytics import Filters
from app.business_data_service import BusinessDataService


class SampleDataHandler:
    """Test records only. This does not connect to a database."""

    def get_analysis_records(self):
        return {
            "products": [
                {
                    "product_id": 1,
                    "category_id": 1,
                    "product_name": "Coffee",
                    "price": "10.00",
                }
            ],
            "customers": [],
            "orders": [
                {
                    "order_id": 1,
                    "order_date": "2026-11-01",
                    "order_time": "10:00:00",
                    "customer_phone": None,
                    "discount": "2.00",
                    "total": "18.00",
                }
            ],
            "orderItems": [
                {
                    "order_item_id": 1,
                    "order_id": 1,
                    "product_id": 1,
                    "quantity": 2,
                    "price": "10.00",
                }
            ],
        }


class AnalyticsServiceTests(unittest.TestCase):
    def test_statistics_from_retrieved_records(self):
        service = BusinessDataService(SampleDataHandler())

        filters = Filters(
            start=date(2026, 11, 1),
            end=date(2026, 11, 2),
            group="day",
        )

        result = service.get_statistics(filters)

        # Two coffees × 10.00 = 20.00 gross.
        # Subtract the 2.00 discount = 18.00 net.
        self.assertEqual(result["summary"]["units"], 2)
        self.assertEqual(result["summary"]["gross"], "20.00")
        self.assertEqual(result["summary"]["discount"], "2.00")
        self.assertEqual(result["summary"]["net"], "18.00")

        # The second day has no sales, but stays in the chart.
        self.assertEqual(result["periods"][1]["units"], 0)

        # An unidentified buyer remains Unknown.
        self.assertEqual(
            result["demographics"][0]["age_group"],
            "Unknown",
        )


if __name__ == "__main__":
    unittest.main()