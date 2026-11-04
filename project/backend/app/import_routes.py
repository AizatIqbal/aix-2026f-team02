"""Save an entire spreadsheet import in one database transaction."""

from datetime import date, time
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from .db.database_manager import DatabaseManager


router = APIRouter(prefix="/api/v1", tags=["imports"])
Money = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]
PositiveID = Annotated[int, Field(gt=0, le=2147483647)]


class ImportedCategory(BaseModel):
    category_name: str = Field(min_length=1, max_length=50)


class ImportedProduct(BaseModel):
    source_product_id: PositiveID | None = None
    product_name: str = Field(min_length=1, max_length=100)
    category_id: int = 0
    category_name: str | None = Field(default=None, max_length=50)
    price: Money


class ImportedOrder(BaseModel):
    source_order_id: PositiveID | None = None
    order_date: date
    order_time: time
    customer_phone: str | None = Field(default=None, max_length=20)
    promocode: str | None = Field(default=None, max_length=30)
    discount: Money = Decimal("0")
    total: Money

    @field_validator("order_time")
    @classmethod
    def local_time(cls, value: time) -> time:
        if value.utcoffset() is not None:
            raise ValueError("Order time must use local time")
        return value.replace(microsecond=0)


class ImportedItem(BaseModel):
    order_id: PositiveID
    product_id: PositiveID
    quantity: PositiveID
    price: Money


class SpreadsheetImport(BaseModel):
    categories: list[ImportedCategory] = Field(default_factory=list)
    products: list[ImportedProduct] = Field(default_factory=list)
    orders: list[ImportedOrder] = Field(default_factory=list)
    orderItems: list[ImportedItem] = Field(default_factory=list)


@router.post("/imports", status_code=201)
def import_spreadsheet(payload: SpreadsheetImport):
    """Preserve supplied IDs so separate sheets can refer to the same records."""
    db = DatabaseManager()
    imported = {"categories": [], "products": [], "orders": [], "orderItems": []}
    try:
        with db.engine.begin() as connection:
            for category in payload.categories:
                name = category.category_name.strip()
                if not name:
                    raise HTTPException(422, "Category name cannot be empty")
                existing = connection.execute(
                    text("SELECT category_id FROM category WHERE category_name = :name"),
                    {"name": name},
                ).scalar_one_or_none()
                if existing is None:
                    result = connection.execute(
                        text("INSERT INTO category (category_name) VALUES (:name)"),
                        {"name": name},
                    )
                    imported["categories"].append({"category_id": result.lastrowid, "category_name": name})

            for product in payload.products:
                name = product.product_name.strip()
                if not name:
                    raise HTTPException(422, "Product name cannot be empty")
                category_id = product.category_id
                if product.category_name:
                    category_id = connection.execute(
                        text("SELECT category_id FROM category WHERE category_name = :name"),
                        {"name": product.category_name.strip()},
                    ).scalar_one_or_none()
                if not category_id or category_id < 1:
                    raise HTTPException(422, f"Choose a valid category for {name}")
                row = {"category_id": category_id, "product_name": name, "price": product.price}
                result = connection.execute(
                    text("""INSERT INTO product (product_id, category_id, product_name, price)
                            VALUES (:product_id, :category_id, :product_name, :price)"""),
                    {**row, "product_id": product.source_product_id},
                )
                imported["products"].append({**row, "product_id": product.source_product_id or result.lastrowid})

            for order in payload.orders:
                row = order.model_dump(exclude={"source_order_id"})
                row["order_time"] = order.order_time.isoformat()
                result = connection.execute(
                    text("""INSERT INTO orders
                            (order_id, order_date, order_time, customer_phone, promocode, discount, total)
                            VALUES (:order_id, :order_date, :order_time, :customer_phone, :promocode, :discount, :total)"""),
                    {**row, "order_id": order.source_order_id},
                )
                imported["orders"].append({
                    **row, "order_id": order.source_order_id or result.lastrowid,
                    "day_of_week": order.order_date.strftime("%A"),
                })

            for item in payload.orderItems:
                row = item.model_dump()
                result = connection.execute(
                    text("""INSERT INTO order_item (order_id, product_id, quantity, price)
                            VALUES (:order_id, :product_id, :quantity, :price)"""),
                    row,
                )
                imported["orderItems"].append({**row, "order_item_id": result.lastrowid})

            for order in imported["orders"]:
                if order["discount"] == 0:
                    continue
                subtotal = connection.execute(
                    text("SELECT COALESCE(SUM(quantity * price), 0) FROM order_item WHERE order_id = :id"),
                    {"id": order["order_id"]},
                ).scalar_one()
                if order["discount"] > subtotal:
                    raise HTTPException(422, f"Order {order['order_id']} discount exceeds its item subtotal")

        return imported
    except IntegrityError as exc:
        raise HTTPException(409, "An imported ID already exists or a referenced record is missing") from exc
    finally:
        db.close()
