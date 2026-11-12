from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from app import main


def make_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE category (
                category_id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_name VARCHAR(50) NOT NULL UNIQUE COLLATE NOCASE
            )
        """))
        connection.execute(text("""
            CREATE TABLE product (
                product_id INTEGER PRIMARY KEY AUTOINCREMENT,
                category_id INTEGER NOT NULL,
                product_name VARCHAR(100) NOT NULL,
                price NUMERIC(10, 2) NOT NULL,
                FOREIGN KEY (category_id) REFERENCES category(category_id)
            )
        """))
        connection.execute(text("""
            CREATE TABLE customer (
                customer_phone VARCHAR(20) PRIMARY KEY,
                customer_name VARCHAR(100) NOT NULL,
                customer_age INTEGER NULL,
                customer_gender VARCHAR(20) NULL
            )
        """))
    return engine


class FakeDatabaseManager:
    def __init__(self, engine):
        self.engine = engine

    def close(self):
        pass


def client_for(monkeypatch, engine):
    monkeypatch.setattr(main, "DatabaseManager", lambda: FakeDatabaseManager(engine))
    return TestClient(main.app)


def test_bulk_import_creates_categories_and_products(monkeypatch):
    engine = make_engine()
    client = client_for(monkeypatch, engine)

    response = client.post("/api/v1/import", json={
        "categories": [{"category_name": "Rice Bowls"}],
        "products": [
            {"product_name": "Kimchi Fried Rice", "category_name": "Rice Bowls", "price": 9500},
            {"product_name": "Mandu", "category_name": "Sides", "price": 5500},
        ],
    })

    assert response.status_code == 200, response.text
    body = response.json()
    assert {item["category_name"] for item in body["categories"]} == {"Rice Bowls", "Sides"}
    assert {item["product_name"] for item in body["products"]} == {"Kimchi Fried Rice", "Mandu"}
    assert body["skipped"] == {"categories": 0, "products": 0}

    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM category")).scalar_one() == 2
        assert connection.execute(text("SELECT COUNT(*) FROM product")).scalar_one() == 2


def test_bulk_import_skips_existing_records_and_is_safe_to_retry(monkeypatch):
    engine = make_engine()
    client = client_for(monkeypatch, engine)
    payload = {
        "categories": [{"category_name": "Drinks"}],
        "products": [{"product_name": "Iced Green Tea", "category_name": "Drinks", "price": 4000}],
    }

    first = client.post("/api/v1/import", json=payload)
    second = client.post("/api/v1/import", json=payload)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert second.json()["categories"] == []
    assert second.json()["products"] == []
    assert second.json()["skipped"] == {"categories": 1, "products": 1}

    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM category")).scalar_one() == 1
        assert connection.execute(text("SELECT COUNT(*) FROM product")).scalar_one() == 1


def test_bulk_import_skips_product_with_unknown_category_id(monkeypatch):
    engine = make_engine()
    client = client_for(monkeypatch, engine)

    response = client.post("/api/v1/import", json={
        "categories": [],
        "products": [{"product_name": "Unknown Category Product", "category_id": 999, "price": 1000}],
    })

    assert response.status_code == 200, response.text
    assert response.json()["products"] == []
    assert response.json()["skipped"]["products"] == 1


def test_bulk_import_accepts_pointnull_food_template(monkeypatch):
    engine = make_engine()
    client = client_for(monkeypatch, engine)

    response = client.post("/api/v1/import", json={
        "categories": [],
        "products": [
            {"product_name": "Kimchi Fried Rice", "category_name": "Rice Bowls", "price": 9500},
            {"product_name": "Seafood Jjigae", "category_name": "Soups & Stews", "price": 12000},
            {"product_name": "Japchae", "category_name": "Noodles", "price": 8500},
            {"product_name": "Iced Green Tea", "category_name": "Drinks", "price": 4000},
            {"product_name": "Mandu", "category_name": "Sides", "price": 5500},
        ],
    })

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["categories"]) == 5
    assert len(body["products"]) == 5
    assert body["skipped"] == {"categories": 0, "products": 0}


def test_bulk_import_adds_customers_and_skips_duplicate_phone_numbers(monkeypatch):
    engine = make_engine()
    client = client_for(monkeypatch, engine)

    response = client.post("/api/v1/import", json={
        "customers": [
            {"customer_name": "Kim Jiyoon", "customer_phone": "010-1234-5678", "customer_age": 29, "customer_gender": "Woman"},
            {"customer_name": "Duplicate", "customer_phone": "01012345678"},
            {"customer_name": "Lee Minho", "customer_phone": "010-9876-5432"},
        ],
    })

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["customers"]) == 2
    assert body["skipped"]["customers"] == 1
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM customer")).scalar_one() == 2
