from sqlalchemy import create_engine, text

from app.db.business_data_handler import SQLAlchemyBusinessDataHandler


class FakeDatabaseManager:
    def __init__(self, engine):
        self.engine = engine


def make_engine_with_canonical_schema():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE category (
                category_id INTEGER PRIMARY KEY,
                category_name VARCHAR(50) NOT NULL
            )
        """))
        connection.execute(text("""
            CREATE TABLE product (
                product_id INTEGER PRIMARY KEY,
                category_id INTEGER NOT NULL,
                product_name VARCHAR(100) NOT NULL,
                price NUMERIC(10, 2) NOT NULL
            )
        """))
        connection.execute(text("""
            CREATE TABLE customer (
                customer_phone VARCHAR(20) PRIMARY KEY,
                customer_name VARCHAR(100) NOT NULL,
                customer_age INTEGER,
                customer_gender VARCHAR(20)
            )
        """))
        connection.execute(text("""
            CREATE TABLE campaign (
                promocode VARCHAR(30) PRIMARY KEY,
                campaign_name VARCHAR(100) NOT NULL,
                channel VARCHAR(30) NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                budget NUMERIC(12, 2) NOT NULL
            )
        """))
        connection.execute(text("""
            CREATE TABLE orders (
                order_id INTEGER PRIMARY KEY,
                order_date DATE NOT NULL,
                order_time TIME NOT NULL,
                customer_phone VARCHAR(20),
                promocode VARCHAR(30),
                discount NUMERIC(10, 2) NOT NULL,
                total NUMERIC(10, 2) NOT NULL
            )
        """))
        connection.execute(text("""
            CREATE TABLE order_item (
                order_item_id INTEGER PRIMARY KEY,
                order_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                price NUMERIC(10, 2) NOT NULL
            )
        """))
        connection.execute(text("INSERT INTO category VALUES (1, 'Beverages')"))
        connection.execute(text("INSERT INTO product VALUES (1, 1, 'Coffee', 10.00)"))
        connection.execute(text("INSERT INTO customer VALUES ('010-0000-0000', 'Kim', 24, 'Female')"))
        connection.execute(text("INSERT INTO campaign VALUES ('WELCOME', 'Welcome', 'email', '2026-11-01', '2026-11-30', 500)"))
        connection.execute(text("""
            INSERT INTO orders
                (order_id, order_date, order_time, customer_phone, promocode, discount, total)
            VALUES (1, '2026-11-01', '10:00:00', '010-0000-0000', 'WELCOME', 2.00, 18.00)
        """))
        connection.execute(text("""
            INSERT INTO order_item
                (order_item_id, order_id, product_id, quantity, price)
            VALUES (1, 1, 1, 2, 10.00)
        """))
    return engine


def test_handler_reads_canonical_management_schema_names():
    engine = make_engine_with_canonical_schema()
    try:
        data = SQLAlchemyBusinessDataHandler(FakeDatabaseManager(engine)).get_analysis_records()
    finally:
        engine.dispose()

    assert data["products"][0]["product_name"] == "Coffee"
    assert data["customers"][0]["customer_phone"] == "010-0000-0000"
    assert data["campaigns"][0]["campaign_name"] == "Welcome"
    assert data["orders"][0]["promocode"] == "WELCOME"
    assert str(data["orders"][0]["discount"]) == "2.00"
    assert data["orderItems"][0]["quantity"] == 2


def test_handler_rejects_percentage_discount_for_decimal_schema():
    engine = make_engine_with_canonical_schema()
    with engine.begin() as connection:
        connection.execute(text("UPDATE orders SET discount = '15%' WHERE order_id = 1"))
    try:
        handler = SQLAlchemyBusinessDataHandler(FakeDatabaseManager(engine))
        try:
            handler.get_analysis_records()
        except Exception as exc:
            assert "discount" in str(exc).lower() or "number" in str(exc).lower()
        else:
            raise AssertionError("Invalid DECIMAL discount was accepted")
    finally:
        engine.dispose()
