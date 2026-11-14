import os
import uuid
from decimal import Decimal
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from datetime import date

from app.db.database_manager import DatabaseManager
from app.statistics_routes import router as statistics_router


app = FastAPI(
    title="PointNull Management and Analytics API",
    version="0.1.0",
)

# Product images are stored outside the source tree and served as static files.
BACKEND_DIR = Path(__file__).resolve().parents[1]
UPLOAD_ROOT = BACKEND_DIR / "uploads"
PRODUCT_IMAGE_DIR = UPLOAD_ROOT / "products"
MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"

app.mount(
    "/uploads",
    StaticFiles(directory=str(UPLOAD_ROOT), check_dir=False),
    name="uploads",
)


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:8443",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8443",
        "http://192.168.0.104:8443",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# REQUEST MODELS

class CategoryCreate(BaseModel):
    category_name: str = Field(min_length=1, max_length=50)


class ProductCreate(BaseModel):
    category_id: int = Field(gt=0)
    product_name: str = Field(min_length=1, max_length=100)
    price: Decimal = Field(ge=0)
    image_url: str | None = Field(default=None, max_length=512)


class ProductUpdate(ProductCreate):
    pass


class ProductActiveUpdate(BaseModel):
    active: bool


class OrderItemCreate(BaseModel):
    product_id: int = Field(gt=0)
    quantity: int = Field(gt=0)


class OrderCreate(BaseModel):
    items: list[OrderItemCreate] = Field(min_length=1)
    customer_phone: str | None = Field(default=None, max_length=20)
    promocode: str | None = Field(default=None, max_length=30)
    # Kept for compatibility with the original checkout contract. Campaign
    # discounts are calculated from the campaign record when a promocode exists.
    discount: Decimal = Field(default=Decimal("0"), ge=0)


class CampaignValidationRequest(BaseModel):
    promocode: str = Field(min_length=1, max_length=30)
    subtotal: Decimal = Field(ge=0)


class CustomerCreate(BaseModel):
    customer_phone: str = Field(min_length=1, max_length=20)
    customer_name: str = Field(min_length=1, max_length=100)
    customer_age: int | None = Field(default=None, ge=0, le=120)
    customer_gender: str | None = Field(default=None, max_length=20)


class CampaignCreate(BaseModel):
    promocode: str = Field(min_length=1, max_length=30)
    campaign_name: str = Field(min_length=1, max_length=100)
    channel: str = Field(min_length=1, max_length=30)
    start_date: date
    end_date: date
    budget: Decimal = Field(default=Decimal("0"), ge=0)
    discount_value: Decimal = Field(default=Decimal("0"), ge=0)


class BulkImportCategory(BaseModel):
    category_name: str = Field(min_length=1, max_length=50)


class BulkImportProduct(BaseModel):
    product_name: str = Field(min_length=1, max_length=100)
    price: Decimal = Field(ge=0)
    category_id: int | None = Field(default=None, gt=0)
    category_name: str | None = Field(default=None, max_length=50)
    source_product_id: int | None = Field(default=None, gt=0)


class BulkImportCustomer(BaseModel):
    customer_phone: str = Field(min_length=1, max_length=20)
    customer_name: str = Field(min_length=1, max_length=100)
    customer_age: int | None = Field(default=None, ge=0, le=120)
    customer_gender: str | None = Field(default=None, max_length=20)


class BulkImportRequest(BaseModel):
    categories: list[BulkImportCategory] = Field(default_factory=list, max_length=5000)
    products: list[BulkImportProduct] = Field(default_factory=list, max_length=5000)
    customers: list[BulkImportCustomer] = Field(default_factory=list, max_length=5000)



# HEALTH CHECKS

@app.get("/api/v1/health", tags=["health"])
def health_check():
    return {"status": "ok"}


@app.get("/api/v1/health/database", tags=["health"])
def database_health_check():
    db = DatabaseManager()

    try:
        db.connect()
        return {
            "status": "connected",
            "database": os.getenv("DB_NAME", "business_management"),
        }
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Database connection failed",
        )
    finally:
        db.close()


# CATEGORIES

@app.get("/api/v1/categories", tags=["categories"])
def get_categories():
    db = DatabaseManager()

    try:
        return db.fetch_all(
            """
            SELECT category_id, category_name
            FROM category
            ORDER BY category_id
            """
        )
    finally:
        db.close()


@app.post("/api/v1/categories", tags=["categories"], status_code=201)
def create_category(category: CategoryCreate):
    name = category.category_name.strip()

    if not name:
        raise HTTPException(
            status_code=422,
            detail="Category name cannot be empty",
        )

    db = DatabaseManager()

    try:
        db.execute_query(
            """
            INSERT INTO category (category_name)
            VALUES (:name)
            """,
            {"name": name},
        )

        return db.fetch_one(
            """
            SELECT category_id, category_name
            FROM category
            WHERE category_name = :name
            """,
            {"name": name},
        )

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="Category already exists",
        )
    finally:
        db.close()


# BULK IMPORT (CATEGORIES + PRODUCTS)

@app.post("/api/v1/import", tags=["import"], status_code=200)
def bulk_import(payload: BulkImportRequest):
    """Import categories and products in one transaction.

    Category names are resolved by the database. Missing categories referenced
    by products are created automatically. Existing categories and products
    are skipped, so retrying the same file is safe.
    """
    if not payload.categories and not payload.products and not payload.customers:
        raise HTTPException(
            status_code=422,
            detail="The import file contains no categories, products or customers",
        )

    db = DatabaseManager()
    imported_categories = []
    imported_products = []
    imported_customers = []
    skipped_categories = 0
    skipped_products = 0
    skipped_customers = 0
    category_ids_by_name = {}

    try:
        with db.engine.begin() as connection:
            # Import explicitly mapped categories first.
            for item in payload.categories:
                name = item.category_name.strip()
                if not name:
                    skipped_categories += 1
                    continue

                key = name.casefold()
                if key in category_ids_by_name:
                    skipped_categories += 1
                    continue

                existing = connection.execute(
                    text("""
                        SELECT category_id, category_name
                        FROM category
                        WHERE category_name = :name
                        LIMIT 1
                    """),
                    {"name": name},
                ).mappings().first()

                if existing:
                    category_ids_by_name[key] = existing["category_id"]
                    skipped_categories += 1
                    continue

                result = connection.execute(
                    text("INSERT INTO category (category_name) VALUES (:name)"),
                    {"name": name},
                )
                category_id = int(result.lastrowid)
                category = {
                    "category_id": category_id,
                    "category_name": name,
                }
                imported_categories.append(category)
                category_ids_by_name[key] = category_id

            # Resolve each product's category, creating a missing named
            # category rather than fabricating AUTO_INCREMENT IDs in the UI.
            for item in payload.products:
                product_name = item.product_name.strip()
                if not product_name:
                    skipped_products += 1
                    continue

                category_id = item.category_id
                category_name = (item.category_name or "").strip()

                if category_name:
                    key = category_name.casefold()
                    category_id = category_ids_by_name.get(key)

                    if category_id is None:
                        existing = connection.execute(
                            text("""
                                SELECT category_id, category_name
                                FROM category
                                WHERE category_name = :name
                                LIMIT 1
                            """),
                            {"name": category_name},
                        ).mappings().first()

                        if existing:
                            category_id = int(existing["category_id"])
                            category_ids_by_name[key] = category_id
                        else:
                            result = connection.execute(
                                text("INSERT INTO category (category_name) VALUES (:name)"),
                                {"name": category_name},
                            )
                            category_id = int(result.lastrowid)
                            imported_categories.append({
                                "category_id": category_id,
                                "category_name": category_name,
                            })
                            category_ids_by_name[key] = category_id

                if category_id is None:
                    skipped_products += 1
                    continue

                category_exists = connection.execute(
                    text("SELECT category_id FROM category WHERE category_id = :id"),
                    {"id": category_id},
                ).first()
                if not category_exists:
                    skipped_products += 1
                    continue

                duplicate = connection.execute(
                    text("""
                        SELECT product_id
                        FROM product
                        WHERE category_id = :category_id
                          AND product_name = :product_name
                        LIMIT 1
                    """),
                    {"category_id": category_id, "product_name": product_name},
                ).first()
                if duplicate:
                    skipped_products += 1
                    continue

                result = connection.execute(
                    text("""
                        INSERT INTO product (category_id, product_name, price)
                        VALUES (:category_id, :product_name, :price)
                    """),
                    {
                        "category_id": category_id,
                        "product_name": product_name,
                        "price": str(item.price),
                    },
                )
                product_id = int(result.lastrowid)
                imported_products.append({
                    "product_id": product_id,
                    "category_id": int(category_id),
                    "product_name": product_name,
                    "price": item.price,
                    "image_url": None,
                    "active": True,
                })

            # Customer phone is the primary key. Existing phone numbers are
            # skipped rather than overwritten during a bulk import.
            seen_customer_phones = set()
            for item in payload.customers:
                phone = item.customer_phone.strip()
                name = item.customer_name.strip()
                if not phone or not name:
                    skipped_customers += 1
                    continue
                phone_key = "".join(character for character in phone if character.isdigit())
                if not phone_key or phone_key in seen_customer_phones:
                    skipped_customers += 1
                    continue
                seen_customer_phones.add(phone_key)
                existing = connection.execute(
                    text("""
                        SELECT customer_phone FROM customer
                        WHERE REPLACE(REPLACE(REPLACE(customer_phone, '-', ''), ' ', ''), '+', '') = :phone_digits
                        LIMIT 1
                    """),
                    {"phone_digits": phone_key},
                ).first()
                if existing:
                    skipped_customers += 1
                    continue
                connection.execute(
                    text("""
                        INSERT INTO customer (customer_phone, customer_name, customer_age, customer_gender)
                        VALUES (:phone, :name, :age, :gender)
                    """),
                    {
                        "phone": phone,
                        "name": name,
                        "age": item.customer_age,
                        "gender": item.customer_gender.strip() if item.customer_gender else None,
                    },
                )
                imported_customers.append({
                    "customer_phone": phone,
                    "customer_name": name,
                    "customer_age": item.customer_age,
                    "customer_gender": item.customer_gender,
                })

        return {
            "categories": imported_categories,
            "products": imported_products,
            "customers": imported_customers,
            "orders": [],
            "orderItems": [],
            "skipped": {
                "categories": skipped_categories,
                "products": skipped_products,
                **({"customers": skipped_customers} if payload.customers else {}),
            },
        }
    finally:
        db.close()


# PRODUCTS

@app.post("/api/v1/products/images", tags=["products"], status_code=201)
async def upload_product_image(file: UploadFile = File(...)):
    """Upload a PNG/JPEG product image and return its public relative URL."""
    content = await file.read(MAX_PRODUCT_IMAGE_BYTES + 1)
    await file.close()

    if not content:
        raise HTTPException(status_code=400, detail="The uploaded image is empty")
    if len(content) > MAX_PRODUCT_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 5 MB or smaller")

    # Validate the actual file signature rather than trusting the browser's MIME type.
    if content.startswith(PNG_SIGNATURE):
        extension = ".png"
    elif content.startswith(JPEG_SIGNATURE):
        extension = ".jpg"
    else:
        raise HTTPException(
            status_code=415,
            detail="Only PNG and JPEG images are supported",
        )

    PRODUCT_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    destination = PRODUCT_IMAGE_DIR / filename
    destination.write_bytes(content)

    return {"image_url": f"/uploads/products/{filename}"}


@app.get("/api/v1/products", tags=["products"])
def get_products():
    db = DatabaseManager()

    try:
        return db.fetch_all(
            """
            SELECT
                p.product_id,
                p.category_id,
                c.category_name,
                p.product_name,
                p.price,
                p.image_url,
                p.is_active AS active
            FROM product p
            JOIN category c
                ON p.category_id = c.category_id
            ORDER BY p.product_id
            """
        )
    finally:
        db.close()


@app.post("/api/v1/products", tags=["products"], status_code=201)
def create_product(product: ProductCreate):
    name = product.product_name.strip()

    if not name:
        raise HTTPException(
            status_code=422,
            detail="Product name cannot be empty",
        )

    db = DatabaseManager()

    try:
        category = db.fetch_one(
            """
            SELECT category_id
            FROM category
            WHERE category_id = :category_id
            """,
            {"category_id": product.category_id},
        )

        if not category:
            raise HTTPException(
                status_code=404,
                detail="Category not found",
            )

        db.execute_query(
            """
            INSERT INTO product (
                category_id,
                product_name,
                price,
                image_url,
                is_active
            )
            VALUES (
                :category_id,
                :product_name,
                :price,
                :image_url,
                TRUE
            )
            """,
            {
                "category_id": product.category_id,
                "product_name": name,
                "price": product.price,
                "image_url": product.image_url,
            },
        )

        return db.fetch_one(
            """
            SELECT
                product_id,
                category_id,
                product_name,
                price,
                image_url,
                is_active AS active
            FROM product
            WHERE category_id = :category_id
              AND product_name = :product_name
            ORDER BY product_id DESC
            LIMIT 1
            """,
            {
                "category_id": product.category_id,
                "product_name": name,
            },
        )

    finally:
        db.close()


@app.put("/api/v1/products/{product_id}", tags=["products"])
def update_product(product_id: int, product: ProductUpdate):
    name = product.product_name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Product name cannot be empty")

    db = DatabaseManager()
    try:
        category = db.fetch_one(
            "SELECT category_id FROM category WHERE category_id = :category_id",
            {"category_id": product.category_id},
        )
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")

        existing = db.fetch_one(
            "SELECT product_id FROM product WHERE product_id = :product_id",
            {"product_id": product_id},
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Product not found")

        db.execute_query(
            """
            UPDATE product
            SET category_id = :category_id,
                product_name = :product_name,
                price = :price,
                image_url = :image_url
            WHERE product_id = :product_id
            """,
            {
                "category_id": product.category_id,
                "product_name": name,
                "price": product.price,
                "image_url": product.image_url,
                "product_id": product_id,
            },
        )
        return db.fetch_one(
            """
            SELECT product_id, category_id, product_name, price, image_url, is_active AS active
            FROM product WHERE product_id = :product_id
            """,
            {"product_id": product_id},
        )
    finally:
        db.close()


@app.patch("/api/v1/products/{product_id}/active", tags=["products"])
def set_product_active(product_id: int, status: ProductActiveUpdate):
    db = DatabaseManager()
    try:
        existing = db.fetch_one(
            "SELECT product_id FROM product WHERE product_id = :product_id",
            {"product_id": product_id},
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Product not found")
        db.execute_query(
            "UPDATE product SET is_active = :active WHERE product_id = :product_id",
            {"active": status.active, "product_id": product_id},
        )
        return db.fetch_one(
            """
            SELECT product_id, category_id, product_name, price, image_url, is_active AS active
            FROM product WHERE product_id = :product_id
            """,
            {"product_id": product_id},
        )
    finally:
        db.close()


# ORDER ITEMS

@app.get("/api/v1/order-items", tags=["orders"])
def get_order_items():
    db = DatabaseManager()
    try:
        return db.fetch_all(
            """
            SELECT order_item_id, order_id, product_id, quantity, price
            FROM order_item
            ORDER BY order_item_id
            """
        )
    finally:
        db.close()


# ORDERS

@app.get("/api/v1/orders", tags=["orders"])
def get_orders():
    db = DatabaseManager()

    try:
        return db.fetch_all(
            """
            SELECT
                order_id,
                order_date,
                order_time,
                day_of_week,
                customer_phone,
                promocode,
                discount,
                total
            FROM orders
            ORDER BY order_id DESC
            """
        )
    finally:
        db.close()


@app.get("/api/v1/orders/page", tags=["orders"])
def get_orders_page(
    limit: int = Query(default=8, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    start_date: date | None = None,
    end_date: date | None = None,
    order_query: str | None = None,
    customer_query: str | None = None,
    sort: str = "newest",
):
    """Return a lightweight, paginated order list and matching summary."""
    db = DatabaseManager()
    try:
        conditions = []
        filter_params = {}

        if start_date:
            conditions.append("o.order_date >= :start_date")
            filter_params["start_date"] = start_date
        if end_date:
            conditions.append("o.order_date <= :end_date")
            filter_params["end_date"] = end_date
        if order_query:
            raw_order_query = order_query.strip().lower()
            cleaned_order_query = raw_order_query.replace("ord-", "")
            if cleaned_order_query.isdigit() and raw_order_query.startswith("ord-"):
                conditions.append("o.order_id = :order_exact")
                filter_params["order_exact"] = int(cleaned_order_query)
            elif cleaned_order_query:
                conditions.append("CAST(o.order_id AS CHAR) LIKE :order_pattern")
                filter_params["order_pattern"] = f"%{cleaned_order_query.lstrip('0') or '0'}%"
        if customer_query:
            conditions.append("(LOWER(COALESCE(c.customer_name, '')) LIKE :customer_pattern OR LOWER(COALESCE(o.customer_phone, '')) LIKE :customer_pattern)")
            filter_params["customer_pattern"] = f"%{customer_query.strip().lower()}%"

        page_params = {**filter_params, "limit": limit, "offset": offset}
        where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""
        order_by = {
            "newest": "o.order_date DESC, o.order_time DESC, o.order_id DESC",
            "oldest": "o.order_date ASC, o.order_time ASC, o.order_id ASC",
            "highest": "o.total DESC, o.order_date DESC, o.order_time DESC",
            "lowest": "o.total ASC, o.order_date DESC, o.order_time DESC",
        }.get(sort, "o.order_date DESC, o.order_time DESC, o.order_id DESC")

        summary = db.fetch_one(
            f"""
            SELECT
                COUNT(*) AS orders,
                COALESCE(SUM(o.total), 0) AS revenue,
                COALESCE(AVG(o.total), 0) AS average
            FROM orders o
            LEFT JOIN customer c ON c.customer_phone = o.customer_phone
            {where_sql}
            """,
            filter_params,
        ) or {"orders": 0, "revenue": 0, "average": 0}

        item_summary = db.fetch_one(
            f"""
            SELECT COALESCE(SUM(oi.quantity), 0) AS items
            FROM orders o
            LEFT JOIN customer c ON c.customer_phone = o.customer_phone
            LEFT JOIN order_item oi ON oi.order_id = o.order_id
            {where_sql}
            """,
            filter_params,
        ) or {"items": 0}

        items = db.fetch_all(
            f"""
            SELECT
                o.order_id,
                o.order_date,
                o.order_time,
                o.day_of_week,
                o.customer_phone,
                c.customer_name,
                o.promocode,
                o.discount,
                o.total,
                COALESCE((
                    SELECT SUM(oi.quantity)
                    FROM order_item oi
                    WHERE oi.order_id = o.order_id
                ), 0) AS item_count
            FROM orders o
            LEFT JOIN customer c ON c.customer_phone = o.customer_phone
            {where_sql}
            ORDER BY {order_by}
            LIMIT :limit OFFSET :offset
            """,
            page_params,
        )

        return {
            "items": items,
            "total": int(summary["orders"] or 0),
            "summary": {
                "orders": int(summary["orders"] or 0),
                "revenue": float(summary["revenue"] or 0),
                "average": float(summary["average"] or 0),
                "items": int(item_summary["items"] or 0),
            },
        }
    finally:
        db.close()


@app.get("/api/v1/orders/{order_id}", tags=["orders"])
def get_order(order_id: int):
    db = DatabaseManager()

    try:
        order = db.fetch_one(
            """
            SELECT
                o.order_id,
                o.order_date,
                o.order_time,
                o.day_of_week,
                o.customer_phone,
                c.customer_name,
                o.promocode,
                o.discount,
                o.total
            FROM orders o
            LEFT JOIN customer c ON c.customer_phone = o.customer_phone
            WHERE o.order_id = :order_id
            """,
            {"order_id": order_id},
        )

        if not order:
            raise HTTPException(
                status_code=404,
                detail="Order not found",
            )

        order["items"] = db.fetch_all(
            """
            SELECT
                oi.order_item_id,
                oi.product_id,
                p.product_name,
                c.category_name,
                oi.quantity,
                oi.price,
                (oi.quantity * oi.price) AS subtotal
            FROM order_item oi
            JOIN product p ON oi.product_id = p.product_id
            LEFT JOIN category c ON c.category_id = p.category_id
            WHERE oi.order_id = :order_id
            """,
            {"order_id": order_id},
        )

        return order

    finally:
        db.close()


@app.post("/api/v1/orders", tags=["orders"], status_code=201)
def create_order(order: OrderCreate):
    db = DatabaseManager()

    try:
        with db.engine.begin() as connection:
            order_items = []
            subtotal = Decimal("0")

            if order.customer_phone:
                customer = connection.execute(
                    text("SELECT customer_phone FROM customer WHERE customer_phone = :phone"),
                    {"phone": order.customer_phone.strip()},
                ).first()
                if not customer:
                    raise HTTPException(status_code=404, detail="Customer not found")

            for item in order.items:
                product = connection.execute(
                    text("SELECT product_id, product_name, price, is_active FROM product WHERE product_id = :product_id"),
                    {"product_id": item.product_id},
                ).mappings().first()
                if not product:
                    raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")
                if not product["is_active"]:
                    raise HTTPException(status_code=409, detail=f"{product['product_name']} is not currently available")

                price = Decimal(str(product["price"]))
                item_subtotal = price * item.quantity
                subtotal += item_subtotal
                order_items.append({
                    "product_id": item.product_id,
                    "product_name": product["product_name"],
                    "quantity": item.quantity,
                    "price": price,
                    "subtotal": item_subtotal,
                })

            promocode = order.promocode.strip().upper() if order.promocode else None
            discount = order.discount
            if promocode:
                campaign = connection.execute(
                    text("SELECT promocode, start_date, end_date, discount_value FROM campaign WHERE UPPER(promocode) = :promocode"),
                    {"promocode": promocode},
                ).mappings().first()
                if not campaign:
                    raise HTTPException(status_code=422, detail="Campaign code was not found")
                today = date.today()
                if campaign["start_date"] > today or campaign["end_date"] < today:
                    raise HTTPException(status_code=422, detail="This campaign is not currently active")
                # The current campaign schema stores a fixed discount amount.
                campaign_discount = Decimal(str(campaign["discount_value"]))
                if campaign_discount <= 0:
                    raise HTTPException(status_code=422, detail="This campaign has no discount configured")
                discount = min(campaign_discount, subtotal)
            elif discount > subtotal:
                raise HTTPException(status_code=422, detail="Discount cannot exceed order subtotal")

            total = subtotal - discount
            result = connection.execute(
                text("""
                    INSERT INTO orders (customer_phone, promocode, discount, total)
                    VALUES (:customer_phone, :promocode, :discount, :total)
                """),
                {
                    "customer_phone": order.customer_phone.strip() if order.customer_phone else None,
                    "promocode": promocode,
                    "discount": discount,
                    "total": total,
                },
            )
            order_id = result.lastrowid

            for item in order_items:
                connection.execute(
                    text("""
                        INSERT INTO order_item (order_id, product_id, quantity, price)
                        VALUES (:order_id, :product_id, :quantity, :price)
                    """),
                    {
                        "order_id": order_id,
                        "product_id": item["product_id"],
                        "quantity": item["quantity"],
                        "price": item["price"],
                    },
                )

        return {
            "message": "Order created successfully",
            "order_id": order_id,
            "subtotal": subtotal,
            "discount": discount,
            "total": total,
            "customer_phone": order.customer_phone,
            "promocode": promocode,
            "items": order_items,
        }
    finally:
        db.close()


# CUSTOMERS

@app.get("/api/v1/customers/summary", tags=["customers"])
def get_customer_summaries():
    """Return customer profiles with database-aggregated sales statistics."""
    db = DatabaseManager()
    try:
        return db.fetch_all(
            """
            SELECT
                c.customer_phone,
                c.customer_name,
                c.customer_age,
                c.customer_gender,
                COUNT(o.order_id) AS total_orders,
                COALESCE(SUM(o.total), 0) AS total_spent,
                MAX(o.order_date) AS last_order_date
            FROM customer c
            LEFT JOIN orders o ON o.customer_phone = c.customer_phone
            GROUP BY
                c.customer_phone,
                c.customer_name,
                c.customer_age,
                c.customer_gender
            ORDER BY c.customer_name
            """
        )
    finally:
        db.close()


@app.get("/api/v1/customers/{customer_phone}/orders", tags=["customers"])
def get_customer_orders(customer_phone: str, limit: int = Query(default=8, ge=1, le=100)):
    """Load only a customer's recent order history when their profile is opened."""
    db = DatabaseManager()
    try:
        return db.fetch_all(
            """
            SELECT
                order_id,
                order_date,
                order_time,
                day_of_week,
                customer_phone,
                promocode,
                discount,
                total
            FROM orders
            WHERE customer_phone = :phone
            ORDER BY order_date DESC, order_time DESC, order_id DESC
            LIMIT :limit
            """,
            {"phone": customer_phone, "limit": limit},
        )
    finally:
        db.close()


@app.get("/api/v1/customers", tags=["customers"])
def get_customers():
    db = DatabaseManager()

    try:
        return db.fetch_all(
            """
            SELECT
                customer_phone,
                customer_name,
                customer_age,
                customer_gender
            FROM customer
            ORDER BY customer_name
            """
        )
    finally:
        db.close()


@app.get("/api/v1/customers/{customer_phone}", tags=["customers"])
def get_customer(customer_phone: str):
    db = DatabaseManager()

    try:
        customer = db.fetch_one(
            """
            SELECT
                customer_phone,
                customer_name,
                customer_age,
                customer_gender
            FROM customer
            WHERE customer_phone = :phone
            """,
            {"phone": customer_phone},
        )

        if not customer:
            raise HTTPException(
                status_code=404,
                detail="Customer not found",
            )

        return customer

    finally:
        db.close()


@app.post("/api/v1/customers", tags=["customers"], status_code=201)
def create_customer(customer: CustomerCreate):
    name = customer.customer_name.strip()
    phone = customer.customer_phone.strip()

    if not name or not phone:
        raise HTTPException(
            status_code=422,
            detail="Customer name and phone cannot be empty",
        )

    db = DatabaseManager()

    try:
        db.execute_query(
            """
            INSERT INTO customer (
                customer_phone,
                customer_name,
                customer_age,
                customer_gender
            )
            VALUES (
                :phone,
                :name,
                :age,
                :gender
            )
            """,
            {
                "phone": phone,
                "name": name,
                "age": customer.customer_age,
                "gender": customer.customer_gender,
            },
        )

        return db.fetch_one(
            """
            SELECT
                customer_phone,
                customer_name,
                customer_age,
                customer_gender
            FROM customer
            WHERE customer_phone = :phone
            """,
            {"phone": phone},
        )

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="Customer phone number already exists",
        )
    finally:
        db.close()


@app.put("/api/v1/customers/{customer_phone}", tags=["customers"])
def update_customer(customer_phone: str, customer: CustomerCreate):
    original_phone = customer_phone.strip()
    new_phone = customer.customer_phone.strip()
    name = customer.customer_name.strip()
    if not new_phone or not name:
        raise HTTPException(status_code=422, detail="Customer name and phone cannot be empty")

    db = DatabaseManager()
    try:
        existing = db.fetch_one(
            "SELECT customer_phone FROM customer WHERE customer_phone = :phone",
            {"phone": original_phone},
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Customer not found")
        db.execute_query(
            """
            UPDATE customer
            SET customer_phone = :new_phone,
                customer_name = :name,
                customer_age = :age,
                customer_gender = :gender
            WHERE customer_phone = :original_phone
            """,
            {
                "new_phone": new_phone,
                "name": name,
                "age": customer.customer_age,
                "gender": customer.customer_gender,
                "original_phone": original_phone,
            },
        )
        return db.fetch_one(
            """
            SELECT customer_phone, customer_name, customer_age, customer_gender
            FROM customer WHERE customer_phone = :phone
            """,
            {"phone": new_phone},
        )
    except IntegrityError:
        raise HTTPException(status_code=409, detail="Customer phone number already exists")
    finally:
        db.close()


@app.delete("/api/v1/customers/{customer_phone}", tags=["customers"], status_code=204)
def delete_customer(customer_phone: str):
    db = DatabaseManager()
    try:
        existing = db.fetch_one(
            "SELECT customer_phone FROM customer WHERE customer_phone = :phone",
            {"phone": customer_phone.strip()},
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Customer not found")
        # The orders.customer_phone FK is ON DELETE SET NULL, preserving order history.
        db.execute_query(
            "DELETE FROM customer WHERE customer_phone = :phone",
            {"phone": customer_phone.strip()},
        )
        return None
    finally:
        db.close()


# CAMPAIGNS

@app.get("/api/v1/campaigns", tags=["campaigns"])
def get_campaigns():
    db = DatabaseManager()

    try:
        return db.fetch_all(
            """
            SELECT
                promocode,
                campaign_name,
                channel,
                start_date,
                end_date,
                budget,
                discount_value
            FROM campaign
            ORDER BY start_date DESC
            """
        )
    finally:
        db.close()


@app.get("/api/v1/campaigns/{promocode}", tags=["campaigns"])
def get_campaign(promocode: str):
    db = DatabaseManager()

    try:
        campaign = db.fetch_one(
            """
            SELECT
                promocode,
                campaign_name,
                channel,
                start_date,
                end_date,
                budget,
                discount_value
            FROM campaign
            WHERE promocode = :promocode
            """,
            {"promocode": promocode},
        )

        if not campaign:
            raise HTTPException(
                status_code=404,
                detail="Campaign not found",
            )

        return campaign

    finally:
        db.close()


@app.post("/api/v1/campaigns/validate", tags=["campaigns"])
def validate_campaign(request: CampaignValidationRequest):
    code = request.promocode.strip().upper()
    if not code:
        return {"valid": False, "code": "", "discount": 0, "message": "Enter a campaign code."}

    db = DatabaseManager()
    try:
        campaign = db.fetch_one(
            """
            SELECT promocode, campaign_name, start_date, end_date, discount_value
            FROM campaign WHERE UPPER(promocode) = :promocode
            """,
            {"promocode": code},
        )
        if not campaign:
            return {"valid": False, "code": code, "discount": 0, "message": "Campaign code was not found."}

        today = date.today()
        if campaign["start_date"] > today or campaign["end_date"] < today:
            return {"valid": False, "code": code, "discount": 0, "message": "This campaign is not currently active."}

        subtotal = request.subtotal
        discount = min(Decimal(str(campaign["discount_value"])), subtotal)
        if discount <= 0:
            return {"valid": False, "code": code, "discount": 0, "message": "This campaign does not have a discount configured."}

        return {
            "valid": True,
            "code": campaign["promocode"],
            "discount": discount,
            "message": f"{campaign['campaign_name']} applied. You save ₩{discount:,.0f}.",
        }
    finally:
        db.close()


@app.post("/api/v1/campaigns", tags=["campaigns"], status_code=201)
def create_campaign(campaign: CampaignCreate):

    promocode = campaign.promocode.strip()
    name = campaign.campaign_name.strip()
    channel = campaign.channel.strip()

    if not promocode or not name or not channel:
        raise HTTPException(
            status_code=422,
            detail="Promocode, campaign name and channel cannot be empty",
        )

    if campaign.end_date < campaign.start_date:
        raise HTTPException(
            status_code=422,
            detail="End date cannot be earlier than start date",
        )

    db = DatabaseManager()

    try:
        db.execute_query(
            """
            INSERT INTO campaign (
                promocode,
                campaign_name,
                channel,
                start_date,
                end_date,
                budget,
                discount_value
            )
            VALUES (
                :promocode,
                :name,
                :channel,
                :start_date,
                :end_date,
                :budget,
                :discount_value
            )
            """,
            {
                "promocode": promocode,
                "name": name,
                "channel": channel,
                "start_date": campaign.start_date,
                "end_date": campaign.end_date,
                "budget": campaign.budget,
                "discount_value": campaign.discount_value,
            },
        )

        return db.fetch_one(
            """
            SELECT
                promocode,
                campaign_name,
                channel,
                start_date,
                end_date,
                budget,
                discount_value
            FROM campaign
            WHERE promocode = :promocode
            """,
            {"promocode": promocode},
        )

    except IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="Campaign promocode already exists",
        )
    finally:
        db.close()


# ANALYTICS AND RECOMMENDATIONS
app.include_router(statistics_router)
