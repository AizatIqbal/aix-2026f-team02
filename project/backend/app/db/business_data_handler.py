"""SQLAlchemy data adapter for the canonical management_schema_1.sql schema.

The adapter reads the existing lowercase tables and column names. It uses the
application's existing DatabaseManager/SQLAlchemy engine; it does not create a
second database-driver stack or modify stored records.
"""

from collections import defaultdict
from datetime import date
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


def _fetch_all(connection, statement: str, params: dict | None = None) -> list[dict]:
    result = connection.execute(text(statement), params or {})
    return [dict(row) for row in result.mappings().all()]


class SQLAlchemyBusinessDataHandler:
    """Implements the analytics data-handler protocol over SQLAlchemy."""

    def __init__(self, database_manager):
        self.db = database_manager

    def _snapshot_connection(self):
        # MySQL's default transaction isolation is REPEATABLE READ. Set it
        # explicitly for MySQL so all reads see one consistent snapshot.
        connection = self.db.engine.connect()
        if connection.dialect.name == "mysql":
            connection = connection.execution_options(isolation_level="REPEATABLE READ")
        return connection

    def get_sales_date_range(self) -> tuple[date, date] | None:
        """First and last order date, or None when there are no orders."""
        with self.db.engine.connect() as connection:
            row = connection.execute(
                text("SELECT MIN(order_date), MAX(order_date) FROM orders")
            ).first()
        if row is None or row[0] is None:
            return None
        return date.fromisoformat(str(row[0])[:10]), date.fromisoformat(str(row[1])[:10])

    def get_recommendation_records(self) -> dict:
        """Only what recommend_products reads: who bought which product.

        Anonymous orders cannot contribute to customer similarity, so they and
        their items are left in the database.
        """
        connection = self._snapshot_connection()
        try:
            with connection.begin():
                products = _fetch_all(
                    connection, "SELECT product_id, product_name FROM product ORDER BY product_id"
                )
                customers = _fetch_all(
                    connection, "SELECT customer_phone FROM customer ORDER BY customer_phone"
                )
                purchases = _fetch_all(
                    connection,
                    """
                    SELECT DISTINCT o.customer_phone, oi.product_id
                    FROM orders o
                    JOIN order_item oi ON oi.order_id = o.order_id
                    WHERE o.customer_phone IS NOT NULL
                    """,
                )
        finally:
            connection.close()

        # One synthetic "order" per customer keeps the snapshot shape that
        # recommend_products already understands.
        return {
            "products": products,
            "customers": customers,
            "orders": [
                {"order_id": customer["customer_phone"], "customer_phone": customer["customer_phone"]}
                for customer in customers
            ],
            "orderItems": [
                {"order_id": row["customer_phone"], "product_id": row["product_id"]}
                for row in purchases
            ],
        }

    def get_period_records(self, start: date, end: date) -> dict:
        """Like get_analysis_records, but only orders dated start..end (inclusive)."""
        return self.get_analysis_records(start, end)

    def get_analysis_records(self, start: date | None = None, end: date | None = None) -> dict:
        # With a date range the database filters on idx_orders_date, so a
        # 7-day report no longer reads and validates the whole sales history.
        ranged = start is not None and end is not None
        order_filter = "WHERE order_date BETWEEN :start_date AND :end_date" if ranged else ""
        item_filter = (
            "JOIN orders o ON o.order_id = oi.order_id "
            "WHERE o.order_date BETWEEN :start_date AND :end_date"
            if ranged
            else ""
        )
        params = (
            {"start_date": start.isoformat(), "end_date": end.isoformat()} if ranged else {}
        )

        connection = self._snapshot_connection()
        try:
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
                campaigns = _fetch_all(
                    connection,
                    """
                    SELECT promocode, campaign_name, channel, start_date, end_date, budget
                    FROM campaign
                    ORDER BY campaign_name, promocode
                    """,
                )
                orders = _fetch_all(
                    connection,
                    f"""
                    SELECT order_id, customer_phone, promocode, order_date, order_time, discount, total
                    FROM orders
                    {order_filter}
                    ORDER BY order_id
                    """,
                    params,
                )
                order_items = _fetch_all(
                    connection,
                    f"""
                    SELECT oi.order_item_id, oi.order_id, oi.product_id, oi.quantity, oi.price
                    FROM order_item oi
                    {item_filter}
                    ORDER BY oi.order_item_id
                    """,
                    params,
                )
        finally:
            connection.close()

        order_ids = {order["order_id"] for order in orders}
        product_ids = {product["product_id"] for product in products}
        subtotals: dict[int, Decimal] = defaultdict(lambda: Decimal("0.00"))

        rounded_prices: dict = {}
        for item in order_items:
            if item["order_id"] not in order_ids:
                raise ValueError("An order item has no matching order")
            if item["product_id"] not in product_ids:
                raise ValueError("An order item has no matching product")
            quantity = item["quantity"]
            if type(quantity) is not int or quantity <= 0:
                raise ValueError("Order item quantity must be a positive integer")

            raw_price = item["price"]
            rounded_price = rounded_prices.get(raw_price)
            if rounded_price is None:
                price = _decimal(raw_price, "Order item price")
                if price < 0:
                    raise ValueError("Order item price cannot be negative")
                rounded_price = rounded_prices[raw_price] = price.quantize(
                    CENT, rounding=ROUND_HALF_UP
                )
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
            "campaigns": campaigns,
            "orders": orders,
            "orderItems": order_items,
        }
