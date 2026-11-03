"""Read MySQL business records in the format BusinessDataService expects.

Follows project/database/schema.sql (the shared management schema).
orders.discount is a DECIMAL monetary amount, never a percentage.
Money follows the existing analytics module: round unit prices to two
decimal places (half up), then multiply by quantity.
"""

from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from sqlalchemy import text


CENT = Decimal("0.01")


def _decimal(value, label):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{label} must be a valid number") from exc
    if not number.is_finite():
        raise ValueError(f"{label} must be a finite number")
    return number


def _discount_amount(raw, subtotal, order_id):
    number = _decimal(raw, f"Order {order_id} discount amount")
    if number < 0:
        raise ValueError(f"Order {order_id} discount cannot be negative")
    if number > subtotal:
        raise ValueError(f"Order {order_id} discount exceeds its subtotal")
    return number.quantize(CENT, rounding=ROUND_HALF_UP)


class MySQLBusinessDataHandler:
    """Implements the existing BusinessDataHandler protocol by reading MySQL.

    Supply a DatabaseManager dedicated to this operation/request. This
    handler reads records only; it does not repair or overwrite stored data.
    """

    def __init__(self, database_manager):
        self.db = database_manager

    def get_analysis_records(self) -> dict:
        # Every SELECT uses the same repeatable-read transaction.
        with self.db.engine.connect().execution_options(
            isolation_level="REPEATABLE READ"
        ) as connection:
            with connection.begin():
                def fetch_all(query):
                    result = connection.execute(text(query))
                    return [dict(row) for row in result.mappings().all()]

                products = fetch_all("""
                    SELECT product_id, category_id, product_name, price
                    FROM product ORDER BY product_id
                """)
                customers = fetch_all("""
                    SELECT customer_phone, customer_age, customer_gender
                    FROM customer ORDER BY customer_phone
                """)
                orders = fetch_all("""
                    SELECT order_id, customer_phone, order_date, order_time,
                           discount, total
                    FROM orders ORDER BY order_id
                """)
                items = fetch_all("""
                    SELECT order_item_id, order_id, product_id, quantity, price
                    FROM order_item ORDER BY order_item_id
                """)
        order_ids = {order["order_id"] for order in orders}
        product_ids = {product["product_id"] for product in products}
        subtotals = defaultdict(lambda: Decimal("0.00"))
        for item in items:
            if item["order_id"] not in order_ids:
                raise ValueError("An order item has no matching order")
            if item["product_id"] not in product_ids:
                raise ValueError("An order item has no matching product")
            quantity = item["quantity"]
            if type(quantity) is not int or quantity <= 0:
                raise ValueError("Order item quantity must be a positive integer")
            price = _decimal(item["price"], "Order item price")
            if price < 0:
                raise ValueError("Order item price cannot be negative")
            rounded_price = price.quantize(CENT, rounding=ROUND_HALF_UP)
            subtotals[item["order_id"]] += rounded_price * quantity

        for order in orders:
            order_id = order["order_id"]
            order["discount"] = _discount_amount(
                order["discount"], subtotals[order_id], order_id
            )
            # Preserve the stored total. Existing analytics reports any
            # disagreement instead of silently changing the database.
            total = _decimal(order["total"], f"Order {order_id} total")
            if total < 0:
                raise ValueError(f"Order {order_id} total cannot be negative")

        return {
            "products": products,
            "customers": customers,
            "orders": orders,
            "orderItems": items,
        }
