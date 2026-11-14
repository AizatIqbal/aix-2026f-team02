"""HTTP endpoints for sales statistics and product recommendations."""

from collections.abc import Iterator
from datetime import date, time
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, PositiveInt
from sqlalchemy.exc import SQLAlchemyError

from .analytics import Filters
from .business_data_service import BusinessDataService
from .db.business_data_handler import SQLAlchemyBusinessDataHandler
from .db.database_manager import DatabaseManager
from .recommendations import CustomerNotFoundError

router = APIRouter(prefix="/api/v1", tags=["analytics"])


def get_business_data_service() -> Iterator[BusinessDataService]:
    """Create a request-scoped service on the shared connection pool."""
    try:
        database_manager = DatabaseManager()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail="Database configuration is incomplete. Check backend/.env.",
        ) from exc

    try:
        yield BusinessDataService(SQLAlchemyBusinessDataHandler(database_manager))
    finally:
        database_manager.close()


def get_report_filters(
    start: date | None = None,
    end: date | None = None,
    group: Literal["day", "week", "month", "year"] = "day",
    product_ids: list[int] | None = Query(default=None),
    category_ids: list[int] | None = Query(default=None),
    weekdays: list[int] | None = Query(default=None),
    start_time: time = time(0, 0),
    end_time: time = time(23, 59, 59),
    service: BusinessDataService = Depends(get_business_data_service),
) -> Filters:
    """Build report filters. Omit both start and end to cover every sale on record."""
    if (start is None) != (end is None):
        raise HTTPException(
            status_code=422,
            detail="Send both start and end, or neither for all recorded sales",
        )
    if start is None:
        try:
            sales_range = service.get_sales_date_range()
        except SQLAlchemyError as exc:
            raise HTTPException(
                status_code=503,
                detail="The statistics database is unavailable. Check the database connection settings.",
            ) from exc
        start, end = sales_range or (date.today(), date.today())

    try:
        return Filters(
            start=start,
            end=end,
            group=group,
            product_ids=tuple(product_ids or ()),
            category_ids=tuple(category_ids or ()),
            weekdays=tuple(weekdays or ()),
            start_time=start_time,
            end_time=end_time,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/statistics")
def get_statistics(
    filters: Filters = Depends(get_report_filters),
    service: BusinessDataService = Depends(get_business_data_service),
) -> dict:
    """Calculate statistics for an inclusive date range.

    Omit start and end to report on all recorded sales; the response's
    "start" and "end" say which dates were used.
    Repeated query parameters are supported, e.g. ?product_ids=1&product_ids=3.
    Weekday numbering follows Python: Monday=0 through Sunday=6.
    """
    try:
        return service.get_statistics(filters)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="The statistics database is unavailable. Check the database connection settings.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail="Cannot analyze the current records. Check stored sales data or select a smaller date range.",
        ) from exc


@router.get("/recommendations/{customer_phone}")
def get_recommendations(
    customer_phone: str,
    service: BusinessDataService = Depends(get_business_data_service),
) -> dict:
    """Suggest products using purchase overlap with other identified customers."""
    try:
        return service.get_recommendations(customer_phone)
    except CustomerNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Customer not found") from exc
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="The recommendations database is unavailable. Check the database connection settings.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail="Cannot generate recommendations from the current records.") from exc


class DiscountCost(BaseModel):
    product_id: PositiveInt
    # Optional: without it the suggestion comes from sales performance alone.
    unit_cost: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)


@router.post("/discount-suggestions")
def get_discount_suggestion(
    cost: DiscountCost,
    filters: Filters = Depends(get_report_filters),
    service: BusinessDataService = Depends(get_business_data_service),
) -> dict:
    """Suggest a discount from sales performance; a unit cost adds a margin check."""
    try:
        return service.get_discount_suggestion(filters, cost.product_id, cost.unit_cost)
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="The statistics database is unavailable.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail="Cannot evaluate a discount from the current records.") from exc
