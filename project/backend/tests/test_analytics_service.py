from datetime import date

from app.analytics import Filters
from app.business_data_service import BusinessDataService


class SampleDataHandler:
    def get_analysis_records(self):
        return {
            "products": [
                {"product_id": 1, "category_id": 1, "product_name": "Coffee", "price": "10.00"}
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


def test_statistics_from_retrieved_records():
    service = BusinessDataService(SampleDataHandler())
    result = service.get_statistics(
        Filters(start=date(2026, 11, 1), end=date(2026, 11, 2), group="day")
    )

    assert result["summary"]["units"] == 2
    assert result["summary"]["gross"] == "20.00"
    assert result["summary"]["discount"] == "2.00"
    assert result["summary"]["net"] == "18.00"
    assert result["periods"][1]["units"] == 0
    assert result["demographics"][0]["age_group"] == "Unknown"


def test_product_filter_preserves_order_level_discount_allocation():
    snapshot = SampleDataHandler().get_analysis_records()
    filtered = Filters(
        start=date(2026, 11, 1),
        end=date(2026, 11, 1),
        product_ids=(1,),
    )
    result = BusinessDataService(SampleDataHandler()).get_statistics(filtered)
    assert result["summary"]["net"] == "18.00"
