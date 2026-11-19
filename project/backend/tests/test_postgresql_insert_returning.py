import sqlite3
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from app import main


class FakeDatabaseManager:
    def __init__(self, engine):
        self.engine = engine

    def close(self):
        pass


def test_create_order_uses_returning_and_persists_order_items(monkeypatch):
    # sqlite3's bare DB-API adapter does not accept Decimal values by default;
    # PostgreSQL/Psycopg natively supports Decimal for NUMERIC columns.
    sqlite3.register_adapter(Decimal, str)
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE product (
                product_id INTEGER PRIMARY KEY,
                product_name VARCHAR(100) NOT NULL,
                price NUMERIC(10, 2) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
        """))
        connection.execute(text("""
            CREATE TABLE orders (
                order_id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_date DATE NOT NULL DEFAULT CURRENT_DATE,
                order_time TIME NOT NULL DEFAULT CURRENT_TIME,
                customer_phone VARCHAR(20),
                promocode VARCHAR(30),
                discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
                total NUMERIC(10, 2) NOT NULL DEFAULT 0
            )
        """))
        connection.execute(text("""
            CREATE TABLE order_item (
                order_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER NOT NULL,
                price NUMERIC(10, 2) NOT NULL
            )
        """))
        connection.execute(text(
            "INSERT INTO product (product_id, product_name, price, is_active) VALUES (1, 'Bibimbap', 12000, TRUE)"
        ))

    monkeypatch.setattr(main, "DatabaseManager", lambda: FakeDatabaseManager(engine))
    client = TestClient(main.app)
    response = client.post("/api/v1/orders", json={"items": [{"product_id": 1, "quantity": 2}]})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["order_id"] == 1
    assert body["subtotal"] == 24000
    assert body["total"] == 24000

    with engine.connect() as connection:
        saved_order = connection.execute(text("SELECT order_id, total FROM orders")).one()
        saved_item = connection.execute(text("SELECT order_id, product_id, quantity FROM order_item")).one()
        assert saved_order.order_id == 1
        assert float(saved_order.total) == 24000
        assert tuple(saved_item) == (1, 1, 2)

    engine.dispose()
