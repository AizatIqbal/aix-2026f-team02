from datetime import date

from app.analytics import Filters
from app.business_data_service import BusinessDataService
from app.main import CategoryDelete, ProductCreate


class CategorylessDataHandler:
    def get_analysis_records(self):
        return {
            "products": [
                {"product_id": 7, "category_id": None, "product_name": "Daily Special", "price": "12.00"}
            ],
            "customers": [],
            "orders": [
                {
                    "order_id": 9,
                    "order_date": "2026-11-21",
                    "order_time": "12:00:00",
                    "customer_phone": None,
                    "discount": "0.00",
                    "total": "12.00",
                }
            ],
            "orderItems": [
                {"order_item_id": 11, "order_id": 9, "product_id": 7, "quantity": 1, "price": "12.00"}
            ],
        }


def test_product_request_accepts_no_category():
    product = ProductCreate(product_name="Daily Special", price="12.00")
    assert product.category_id is None


def test_category_delete_accepts_uncategorized_action():
    request = CategoryDelete(action="uncategorized")
    assert request.action == "uncategorized"


def test_sales_from_uncategorized_products_are_grouped_under_null_category():
    service = BusinessDataService(CategorylessDataHandler())
    result = service.get_statistics(
        Filters(start=date(2026, 11, 21), end=date(2026, 11, 21), group="day")
    )
    assert result["summary"]["net"] == "12.00"
    assert result["by_category"][0]["category_id"] is None
    assert result["by_category"][0]["net"] == "12.00"
