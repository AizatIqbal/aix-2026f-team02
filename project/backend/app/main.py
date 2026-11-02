from decimal import Decimal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from datetime import date

from app.db.database_manager import DatabaseManager


app = FastAPI(
    title="Business Management and Analytics API",
    version="0.1.0",
)


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:8443",
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


class OrderItemCreate(BaseModel):
    product_id: int = Field(gt=0)
    quantity: int = Field(gt=0)


class OrderCreate(BaseModel):
    items: list[OrderItemCreate] = Field(min_length=1)
    discount: Decimal = Field(default=Decimal("0"), ge=0)


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
            "database": "business_management",
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


# PRODUCTS

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
                p.price
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
                price
            )
            VALUES (
                :category_id,
                :product_name,
                :price
            )
            """,
            {
                "category_id": product.category_id,
                "product_name": name,
                "price": product.price,
            },
        )

        return db.fetch_one(
            """
            SELECT
                product_id,
                category_id,
                product_name,
                price
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
                discount,
                total
            FROM orders
            ORDER BY order_id DESC
            """
        )
    finally:
        db.close()


@app.get("/api/v1/orders/{order_id}", tags=["orders"])
def get_order(order_id: int):
    db = DatabaseManager()

    try:
        order = db.fetch_one(
            """
            SELECT
                order_id,
                order_date,
                order_time,
                day_of_week,
                discount,
                total
            FROM orders
            WHERE order_id = :order_id
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
                oi.product_id,
                p.product_name,
                oi.quantity,
                oi.price,
                (oi.quantity * oi.price) AS subtotal
            FROM order_item oi
            JOIN product p
                ON oi.product_id = p.product_id
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
        # Use one transaction for the order and its items.
        with db.engine.begin() as connection:

            order_items = []
            subtotal = Decimal("0")

            # Retrieve product prices from the database.
            for item in order.items:
                product = connection.execute(
                    text(
                        """
                        SELECT product_id, product_name, price
                        FROM product
                        WHERE product_id = :product_id
                        """
                    ),
                    {"product_id": item.product_id},
                ).mappings().first()

                if not product:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Product {item.product_id} not found",
                    )

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

            # Validate discount.
            if order.discount > subtotal:
                raise HTTPException(
                    status_code=422,
                    detail="Discount cannot exceed order subtotal",
                )

            total = subtotal - order.discount

            # Create the order.
            result = connection.execute(
                text(
                    """
                    INSERT INTO orders (discount, total)
                    VALUES (:discount, :total)
                    """
                ),
                {
                    "discount": order.discount,
                    "total": total,
                },
            )

            order_id = result.lastrowid

            # Create the order items.
            for item in order_items:
                connection.execute(
                    text(
                        """
                        INSERT INTO order_item (
                            order_id,
                            product_id,
                            quantity,
                            price
                        )
                        VALUES (
                            :order_id,
                            :product_id,
                            :quantity,
                            :price
                        )
                        """
                    ),
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
            "discount": order.discount,
            "total": total,
            "items": order_items,
        }

    finally:
        db.close()


# CUSTOMERS

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

