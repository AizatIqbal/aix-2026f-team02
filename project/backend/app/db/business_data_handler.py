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
        # Analytics reads multiple related tables and should use one consistent
        # snapshot. Both MySQL and PostgreSQL support REPEATABLE READ.
        connection = self.db.engine.connect()
        if connection.dialect.name in {"mysql", "postgresql"}:
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

    def get_recommendation_records(self, customer_phone: str) -> dict:
        """Load purchase history only for the target customer and their peers.

        A peer is a customer who has bought at least one product also bought by
        the target. Their complete distinct product sets are then loaded so the
        existing Jaccard scoring algorithm remains unchanged.
        """
        with self.db.engine.connect() as connection:
            customer = connection.execute(
                text("SELECT customer_phone FROM customer WHERE customer_phone = :phone"),
                {"phone": customer_phone},
            ).first()
            if customer is None:
                return {"products": [], "customers": [], "orders": [], "orderItems": []}

            purchases = _fetch_all(
                connection,
                """
                WITH target_products AS (
                    SELECT DISTINCT oi.product_id
                    FROM orders target_order
                    JOIN order_item oi ON oi.order_id = target_order.order_id
                    WHERE target_order.customer_phone = :phone
                ),
                related_customers AS (
                    SELECT DISTINCT peer_order.customer_phone
                    FROM orders peer_order
                    JOIN order_item peer_item ON peer_item.order_id = peer_order.order_id
                    JOIN target_products tp ON tp.product_id = peer_item.product_id
                    WHERE peer_order.customer_phone IS NOT NULL
                      AND peer_order.customer_phone <> :phone
                ),
                relevant_customers AS (
                    SELECT :phone AS customer_phone
                    UNION
                    SELECT customer_phone FROM related_customers
                )
                SELECT DISTINCT
                    o.customer_phone,
                    oi.product_id,
                    p.product_name
                FROM relevant_customers rc
                JOIN orders o ON o.customer_phone = rc.customer_phone
                JOIN order_item oi ON oi.order_id = o.order_id
                JOIN product p ON p.product_id = oi.product_id
                ORDER BY o.customer_phone, oi.product_id
                """,
                {"phone": customer_phone},
            )

        customer_phones = sorted({row["customer_phone"] for row in purchases} | {customer_phone})
        product_names = {
            row["product_id"]: row["product_name"]
            for row in purchases
        }
        return {
            "products": [
                {"product_id": product_id, "product_name": product_name}
                for product_id, product_name in product_names.items()
            ],
            "customers": [{"customer_phone": phone} for phone in customer_phones],
            "orders": [
                {"order_id": phone, "customer_phone": phone}
                for phone in customer_phones
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
                    SELECT order_id, customer_phone, promocode, order_date, order_time,
                           reporting_discount AS discount, reporting_total AS total
                    FROM orders
                    {order_filter}
                    ORDER BY order_id
                    """,
                    params,
                )
                order_items = _fetch_all(
                    connection,
                    f"""
                    SELECT oi.order_item_id, oi.order_id, oi.product_id, oi.quantity,
                           oi.reporting_price AS price
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
