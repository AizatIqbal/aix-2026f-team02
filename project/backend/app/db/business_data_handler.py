"""SQLAlchemy data adapter for the canonical management_schema_1.sql schema.

The adapter reads the existing lowercase tables and column names. It uses the
application's existing DatabaseManager/SQLAlchemy engine; it does not create a
second database-driver stack or modify stored records.
"""

from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from sqlalchemy import text

CENT = Decimal("0.01")


def _decimal(value, label: str) -> Decimal:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"{label} must be a valid number") from exc
    if not number.is_finite():
        raise ValueError(f"{label} must be a finite number")
    return number


def _fetch_all(connection, statement: str) -> list[dict]:
    result = connection.execute(text(statement))
    return [dict(row) for row in result.mappings().all()]


class SQLAlchemyBusinessDataHandler:
    """Implements the analytics data-handler protocol over SQLAlchemy."""

    def __init__(self, database_manager):
        self.db = database_manager

    def get_analysis_records(self) -> dict:
        # MySQL's default transaction isolation is REPEATABLE READ. Set it
        # explicitly for MySQL so all four reads see one consistent snapshot.
        connection = self.db.engine.connect()
        try:
            if connection.dialect.name == "mysql":
                connection = connection.execution_options(
                    isolation_level="REPEATABLE READ"
                )

            with connection.begin():
                products = _fetch_all(
                    connection,
                    """
                    SELECT product_id, category_id, product_name, price
                    FROM product
                    ORDER BY product_id
                    """,
                )
                customers = _fetch_all(
                    connection,
                    """
                    SELECT customer_phone, customer_age, customer_gender
                    FROM customer
                    ORDER BY customer_phone
                    """,
                )
                orders = _fetch_all(
                    connection,
                    """
                    SELECT order_id, customer_phone, order_date, order_time, discount, total
                    FROM orders
                    ORDER BY order_id
                    """,
                )
                order_items = _fetch_all(
                    connection,
                    """
                    SELECT order_item_id, order_id, product_id, quantity, price
                    FROM order_item
                    ORDER BY order_item_id
                    """,
                )
        finally:
            connection.close()

        order_ids = {order["order_id"] for order in orders}
        product_ids = {product["product_id"] for product in products}
        subtotals: dict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))

        for item in order_items:
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
            # The canonical schema stores discount as DECIMAL(10,2), i.e. a
            # monetary amount. Percentage strings are not part of this schema.
            discount = _decimal(order["discount"], f"Order {order_id} discount")
            total = _decimal(order["total"], f"Order {order_id} total")
            if discount < 0:
                raise ValueError(f"Order {order_id} discount cannot be negative")
            if discount > subtotals[order_id]:
                raise ValueError(f"Order {order_id} discount exceeds its item subtotal")
            if total < 0:
                raise ValueError(f"Order {order_id} total cannot be negative")

            order["discount"] = discount.quantize(CENT, rounding=ROUND_HALF_UP)
            order["total"] = total.quantize(CENT, rounding=ROUND_HALF_UP)

        return {
            "products": products,
            "customers": customers,
            "orders": orders,
            "orderItems": order_items,
        }
