"""Read MySQL business records in the format BusinessDataService expects.

Discount policy: a trailing '%' means a percentage of the order subtotal;
plain numeric text means a monetary amount; NULL/blank means no discount.
Money follows the existing analytics module: round unit prices to two
decimal places (half up), then multiply by quantity.
"""

from collections import defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


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
    text = "0" if raw is None else str(raw).strip() or "0"
    percentage = text.endswith("%")
    number = _decimal(text[:-1].strip() if percentage else text,
                      f"Order {order_id} discount")
    if number < 0:
        raise ValueError(f"Order {order_id} discount cannot be negative")
    if percentage:
        if number > 100:
            raise ValueError(f"Order {order_id} discount cannot exceed 100%")
        number = subtotal * number / Decimal("100")
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
        self.db.connect()
        connection = self.db.connection
        # Read the four tables from one consistent view, even if sales are
        # being saved by another connection while this operation runs.
        connection.start_transaction(
            isolation_level="REPEATABLE READ",
            consistent_snapshot=True,
            readonly=True,
        )
        try:
            products = self.db.fetch_all("""
                SELECT Product_ID AS product_id,
                       Category_ID AS category_id,
                       Product_Name AS product_name, Price AS price
                FROM `Product` ORDER BY Product_ID
            """)
            customers = self.db.fetch_all("""
                SELECT Customer_ID_Phone AS customer_phone,
                       Customer_Age AS customer_age,
                       Customer_Gender AS customer_gender
                FROM `Customer` ORDER BY Customer_ID_Phone
            """)
            orders = self.db.fetch_all("""
                SELECT Order_ID AS order_id,
                       Customer_ID_Phone AS customer_phone,
                       `Date` AS order_date, `Time` AS order_time,
                       Discount AS discount, Total AS total
                FROM `Orders` ORDER BY Order_ID
            """)
            items = self.db.fetch_all("""
                SELECT Order_Item_ID AS order_item_id,
                       Order_ID AS order_id, Product_ID AS product_id,
                       Quantity AS quantity, Price AS price
                FROM `Order_Item` ORDER BY Order_Item_ID
            """)
            connection.commit()
        except Exception:
            connection.rollback()
            raise

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
