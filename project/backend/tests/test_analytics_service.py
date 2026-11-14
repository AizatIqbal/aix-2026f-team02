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


def test_campaign_totals_use_selected_items_and_count_each_linked_order_once():
    snapshot = SampleDataHandler().get_analysis_records()
    snapshot["campaigns"] = [{
        "promocode": "WELCOME",
        "campaign_name": "Welcome",
        "channel": "email",
        "budget": "500.00",
        "start_date": "2026-11-01",
        "end_date": "2026-11-30",
    }]
    snapshot["orders"][0].update(promocode="WELCOME", total="28.00")
    snapshot["products"].append({
        "product_id": 2, "category_id": 2, "product_name": "Cake", "price": "10.00",
    })
    snapshot["orderItems"].append({
        "order_item_id": 2, "order_id": 1, "product_id": 2, "quantity": 1, "price": "10.00",
    })

    class CampaignDataHandler:
        def get_analysis_records(self):
            return snapshot

    service = BusinessDataService(CampaignDataHandler())
    start = end = date(2026, 11, 1)
    campaign = service.get_statistics(Filters(start, end))["by_campaign"][0]
    assert (campaign["orders"], campaign["net"], campaign["budget"]) == (1, "28.00", "500.00")
    selected = service.get_statistics(Filters(start, end, category_ids=(1,)))["by_campaign"][0]
    assert (selected["orders"], selected["discount"], selected["net"]) == (1, "1.33", "18.67")
