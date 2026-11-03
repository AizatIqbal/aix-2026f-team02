import pytest

from app.recommendations import CustomerNotFoundError, recommend_products


@pytest.fixture

def purchase_snapshot():
    return {
        "products": [
            {"product_id": 1, "product_name": "Bulgogi Rice Bowl"},
            {"product_id": 2, "product_name": "Iced Americano"},
            {"product_id": 3, "product_name": "Kimchi Jjigae"},
        ],
        "customers": [
            {"customer_phone": "customer-a"},
            {"customer_phone": "customer-b"},
            {"customer_phone": "customer-c"},
        ],
        "orders": [
            {"order_id": 1, "customer_phone": "customer-a"},
            {"order_id": 2, "customer_phone": "customer-b"},
            {"order_id": 3, "customer_phone": "customer-c"},
        ],
        "orderItems": [
            {"order_item_id": 1, "order_id": 1, "product_id": 1},
            {"order_item_id": 2, "order_id": 2, "product_id": 1},
            {"order_item_id": 3, "order_id": 2, "product_id": 2},
            {"order_item_id": 4, "order_id": 3, "product_id": 1},
            {"order_item_id": 5, "order_id": 3, "product_id": 2},
        ],
    }


def test_recommendation_requires_support_and_excludes_previous_purchases(purchase_snapshot):
    result = recommend_products(purchase_snapshot, "customer-a")
    assert result["status"] == "ok"
    assert result["items"] == [
        {
            "product_id": 2,
            "product_name": "Iced Americano",
            "score": 1.0,
            "supporting_customers": 2,
        }
    ]


def test_unknown_customer_is_not_given_fabricated_recommendations(purchase_snapshot):
    with pytest.raises(CustomerNotFoundError):
        recommend_products(purchase_snapshot, "not-a-customer")


def test_no_overlap_returns_empty_result(purchase_snapshot):
    result = recommend_products(purchase_snapshot, "customer-b", min_support=3)
    assert result["items"] == []
    assert result["status"] == "insufficient_overlap"
