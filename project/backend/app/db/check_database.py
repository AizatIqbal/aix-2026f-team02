"""Check the configured management database without changing its records.

From project/backend: python -m app.db.check_database
"""

from sqlalchemy import Numeric, inspect, text
from sqlalchemy.exc import SQLAlchemyError

from .database_manager import DatabaseManager


REQUIRED_COLUMNS = {
    "category": {"category_id", "category_name"},
    "customer": {"customer_phone", "customer_name", "customer_age", "customer_gender"},
    "campaign": {"promocode", "campaign_name", "channel", "start_date", "end_date",
                 "budget", "discount_value"},
    "product": {"product_id", "category_id", "product_name", "price"},
    "orders": {"order_id", "order_date", "order_time", "day_of_week",
               "customer_phone", "promocode", "discount", "total"},
    "order_item": {"order_item_id", "order_id", "product_id", "quantity", "price"},
}


def validate_management_schema(connection):
    """Detect missing management columns and an incompatible discount type."""
    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    problems = []
    for table, required in REQUIRED_COLUMNS.items():
        if table not in tables:
            problems.append(f"Missing table: {table}")
            continue
        columns = {column["name"]: column for column in inspector.get_columns(table)}
        missing = required - columns.keys()
        if missing:
            problems.append(f"{table} missing columns: {', '.join(sorted(missing))}")
        if table == "orders" and "discount" in columns:
            discount_type = columns["discount"]["type"]
            if not isinstance(discount_type, Numeric) or discount_type.scale != 2:
                problems.append("orders.discount must be DECIMAL with 2 decimal places (money)")
    if problems:
        raise ValueError("Management schema mismatch:\n" + "\n".join(problems))


def main():
    db = None
    try:
        db = DatabaseManager()
        with db.engine.connect() as connection:
            database_name = connection.execute(text("SELECT DATABASE()")).scalar_one()
            validate_management_schema(connection)
        # Exercise the same reader used by the statistics API, not only SELECT 1.
        from .business_data_handler import MySQLBusinessDataHandler

        records = MySQLBusinessDataHandler(db).get_analysis_records()
        print(f"Database: {database_name}")
        print("Management table/column and discount-type checks passed.")
        print(f"Read {len(records['products'])} products, "
              f"{len(records['orders'])} orders and {len(records['orderItems'])} order items.")
    except SQLAlchemyError:
        raise SystemExit("Database check failed. Check MySQL, DB_* settings and schema.sql setup.")
    except (RuntimeError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    finally:
        if db is not None:
            db.close()


if __name__ == "__main__":
    main()
