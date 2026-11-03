"""Opt-in tests against real MySQL; each test creates its own disposable database.

Set MYSQL_TEST_SERVER_URL to a mysql+pymysql:// URL whose account may create
databases. No existing database is imported, modified or dropped by these tests.
"""

import os
import re
from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError

from app.db.check_database import validate_management_schema
from app.db.database_manager import DatabaseManager
from app.db.sql_loader import SQLLoader
from app.main import app


pytestmark = pytest.mark.skipif(
    not os.getenv("MYSQL_TEST_SERVER_URL"),
    reason="Set MYSQL_TEST_SERVER_URL to run disposable real-MySQL integration tests",
)


@pytest.fixture
def management_database(monkeypatch):
    url = make_url(os.environ["MYSQL_TEST_SERVER_URL"])
    if url.drivername != "mysql+pymysql":
        pytest.fail("MYSQL_TEST_SERVER_URL must use mysql+pymysql")
    name = "analytics_test_" + uuid4().hex
    server = create_engine(url.set(database=None), isolation_level="AUTOCOMMIT")
    with server.connect() as connection:
        connection.execute(text(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4"))
    db = None
    try:
        for key, value in {
            "DB_HOST": url.host or "localhost", "DB_PORT": str(url.port or 3306),
            "DB_USER": url.username or "root", "DB_PASSWORD": url.password or "",
            "DB_NAME": name,
        }.items():
            monkeypatch.setenv(key, value)
        db = DatabaseManager()
        sql = re.sub(r"--[^\n]*", "", SQLLoader().load_sql_file("schema.sql"))
        with db.engine.begin() as connection:
            for statement in sql.split(";"):
                if statement.strip().upper().startswith("CREATE TABLE"):
                    connection.execute(text(statement))
            validate_management_schema(connection)
        yield db
    finally:
        if db is not None:
            db.close()
        # Only this fixture's randomly generated database is removed.
        with server.connect() as connection:
            connection.execute(text(f"DROP DATABASE `{name}`"))
        server.dispose()


def test_shared_manager_supports_named_parameters_and_dictionary_rows(management_database):
    db = management_database
    assert db.connect() is True
    name = "Cafe's drinks"
    assert db.execute_query(
        "INSERT INTO category (category_name) VALUES (:name)", {"name": name}
    ) == 1
    row = db.fetch_one("SELECT category_name FROM category WHERE category_name=:name", {"name": name})
    assert row == {"category_name": name}
    assert db.fetch_all("SELECT category_name FROM category") == [row]
    assert db.fetch_one("SELECT category_id FROM category WHERE category_id=-1") is None


def test_default_order_fields_and_money_discount_reach_statistics(management_database):
    db = management_database
    with db.engine.begin() as connection:
        connection.execute(text("INSERT INTO category (category_name) VALUES ('Drinks')"))
        connection.execute(text("INSERT INTO product (category_id, product_name, price) VALUES (1,'Coffee',10.00)"))
        connection.execute(text("INSERT INTO orders (discount,total) VALUES (2.00,18.00)"))
        connection.execute(text("INSERT INTO order_item (order_id,product_id,quantity,price) VALUES (1,1,2,10.00)"))
    order = db.fetch_one("SELECT order_date, order_time, day_of_week, customer_phone, promocode FROM orders")
    assert order["order_date"] == date.today()
    assert order["order_time"] is not None
    assert order["day_of_week"] == date.today().strftime("%A")
    assert order["customer_phone"] is None and order["promocode"] is None
    with TestClient(app) as client:
        response = client.get("/api/v1/statistics", params={"start": date.today(), "end": date.today()})
    assert response.status_code == 200
    result = response.json()
    assert result["summary"]["gross"] == "20.00"
    assert result["summary"]["discount"] == "2.00"
    assert result["summary"]["net"] == "18.00"
    assert result["summary"]["identified_orders"] == 0
    assert result["warnings"] == []
    with pytest.raises(DBAPIError) as failure:
        db.execute_query("INSERT INTO order_item (order_id,product_id,quantity,price) VALUES (1,1,-1,10.00)")
    assert failure.value.orig.args[0] == 3819  # MySQL CHECK constraint violation.


def test_management_schema_preserves_48_cola_statistics(management_database):
    db = management_database
    with db.engine.begin() as connection:
        statements = [
            "INSERT INTO category (category_name) VALUES ('Drinks')",
            "INSERT INTO product (category_id,product_name,price) VALUES (1,'Cola',1980.50)",
            "INSERT INTO customer VALUES ('test-customer','Test Customer',25,'Male')",
            "INSERT INTO orders (order_date,order_time,customer_phone,discount,total) "
            "VALUES ('2026-11-01','17:30:00','test-customer',14259.60,80804.40)",
            "INSERT INTO order_item (order_id,product_id,quantity,price) VALUES (1,1,48,1980.50)",
        ]
        for statement in statements:
            connection.execute(text(statement))
    with TestClient(app) as client:
        for group in ("day", "week", "month", "year"):
            response = client.get("/api/v1/statistics", params={
                "start": "2026-11-01", "end": "2026-11-02", "group": group,
            })
            assert response.status_code == 200
            result = response.json()
            assert result["summary"]["units"] == 48
            assert result["summary"]["gross"] == "95064.00"
            assert result["summary"]["discount"] == "14259.60"
            assert result["summary"]["net"] == "80804.40"
            assert result["summary"]["demographic_coverage_percent"] == 100.0
            assert result["warnings"] == []
    # Analytics reads do not rewrite stored money or orders.
    assert db.fetch_one("SELECT discount, total FROM orders WHERE order_id=1") == {
        "discount": Decimal("14259.60"), "total": Decimal("80804.40"),
    }


def test_schema_setup_can_run_again_without_removing_sales(management_database):
    db = management_database
    db.execute_query("INSERT INTO category (category_name) VALUES ('Keep this record')")
    sql = re.sub(r"--[^\n]*", "", SQLLoader().load_sql_file("schema.sql"))
    with db.engine.begin() as connection:
        for statement in sql.split(";"):
            if statement.strip().upper().startswith("CREATE TABLE"):
                connection.execute(text(statement))
    assert db.fetch_all("SELECT category_name FROM category") == [{"category_name": "Keep this record"}]
