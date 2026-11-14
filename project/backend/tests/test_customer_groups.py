"""Customer-group figures in the statistics (used by the Excel report)."""

from datetime import date

from app.analytics import Filters, analyze

DAY = date(2026, 11, 1)


def snapshot():
    customers = [
        {"customer_phone": "a", "customer_age": 22, "customer_gender": "Female"},
        {"customer_phone": "b", "customer_age": 22, "customer_gender": "Male"},
        {"customer_phone": "c", "customer_age": 40, "customer_gender": "Female"},
        {"customer_phone": "d", "customer_age": None, "customer_gender": "Male"},  # age unknown
        {"customer_phone": "e", "customer_age": 70, "customer_gender": None},  # gender unknown
    ]
    products = [
        {"product_id": 1, "category_id": 1, "product_name": "Coffee", "price": "10.00"},
        {"product_id": 2, "category_id": 2, "product_name": "Cake", "price": "20.00"},
    ]
    # (order_id, phone, [(product_id, quantity)])
    sales = [
        (1, "a", [(1, 2), (2, 1)]),
        (2, "a", [(1, 1)]),
        (3, "b", [(2, 2)]),
        (4, "c", [(1, 5)]),
        (5, "d", [(1, 1)]),
        (6, "e", [(2, 1)]),
        (7, None, [(1, 9)]),  # no customer: never in a group
    ]
    prices = {1: 10, 2: 20}
    orders, items = [], []
    for order_id, phone, lines in sales:
        orders.append({
            "order_id": order_id,
            "order_date": DAY.isoformat(),
            "order_time": "10:00:00",
            "customer_phone": phone,
            "discount": "0.00",
            "total": f"{sum(prices[p] * q for p, q in lines)}.00",
        })
        for product_id, quantity in lines:
            items.append({
                "order_item_id": len(items) + 1,
                "order_id": order_id,
                "product_id": product_id,
                "quantity": quantity,
                "price": f"{prices[product_id]}.00",
            })
    return {"products": products, "customers": customers, "orders": orders, "orderItems": items}


def groups(**filters):
    return analyze(snapshot(), Filters(DAY, DAY, **filters))["customer_groups"]


def test_totals_cover_every_linked_order():
    result = groups()
    assert (result["customers"], result["orders"]) == (5, 6)


def test_age_groups_are_ordered_and_skip_unknown_ages():
    ages = groups()["age_groups"]
    assert [row["age_group"] for row in ages] == ["18-24", "35-44", "65+"]
    young = ages[0]  # customers a and b: orders 1, 2 and 3
    assert (young["customers"], young["orders"], young["units"], young["net"]) == (2, 3, 6, "90.00")
    assert [(p["product_name"], p["units"]) for p in young["top_products"]] == [("Coffee", 3), ("Cake", 3)]


def test_genders_skip_unknown_gender():
    genders = {row["gender"]: row for row in groups()["genders"]}
    assert set(genders) == {"Female", "Male"}
    assert (genders["Female"]["customers"], genders["Female"]["orders"], genders["Female"]["net"]) == (2, 3, "100.00")
    assert (genders["Male"]["customers"], genders["Male"]["orders"], genders["Male"]["net"]) == (2, 2, "50.00")


def test_age_by_gender_needs_both_values():
    cells = {(row["age_group"], row["gender"]): row for row in groups()["age_gender"]}
    assert set(cells) == {("18-24", "Female"), ("18-24", "Male"), ("35-44", "Female")}
    assert cells[("18-24", "Female")]["units"] == 4
    assert cells[("35-44", "Female")]["net"] == "50.00"


def test_groups_follow_the_filters():
    result = groups(category_ids=(2,))  # Cake only
    assert [row["age_group"] for row in result["age_groups"]] == ["18-24", "65+"]
    assert result["age_groups"][0]["units"] == 3
    assert result["orders"] == 3


def test_no_linked_orders_gives_empty_groups():
    data = snapshot()
    for order in data["orders"]:
        order["customer_phone"] = None
    result = analyze(data, Filters(DAY, DAY))["customer_groups"]
    assert result == {"customers": 0, "orders": 0, "age_groups": [], "genders": [], "age_gender": []}


def test_products_report_their_category():
    products = analyze(snapshot(), Filters(DAY, DAY))["products"]
    assert {row["product_name"]: row["category_id"] for row in products} == {"Coffee": 1, "Cake": 2}
