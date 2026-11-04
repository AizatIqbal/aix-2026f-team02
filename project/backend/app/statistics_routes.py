"""HTTP endpoints for sales statistics and product recommendations."""

from collections.abc import Iterator
from datetime import date, time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError

from .analytics import Filters
from .business_data_service import BusinessDataService
from .db.business_data_handler import SQLAlchemyBusinessDataHandler
from .db.database_manager import DatabaseManager
from .recommendations import CustomerNotFoundError

router = APIRouter(prefix="/api/v1", tags=["analytics"])


def get_business_data_service() -> Iterator[BusinessDataService]:
    """Create a request-scoped manager and always dispose its connection pool."""
    try:
        database_manager = DatabaseManager()
    except (RuntimeError, ValueError, SQLAlchemyError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Database configuration is incomplete. Check backend/.env.",
        ) from exc

    try:
        yield BusinessDataService(SQLAlchemyBusinessDataHandler(database_manager))
    finally:
        database_manager.close()


@router.get("/statistics")
def get_statistics(
    start: date,
    end: date,
    group: Literal["day", "week", "month", "year"] = "day",
    product_ids: list[int] | None = Query(default=None),
    category_ids: list[int] | None = Query(default=None),
    weekdays: list[int] | None = Query(default=None),
    start_time: time = time(0, 0),
    end_time: time = time(23, 59, 59),
    service: BusinessDataService = Depends(get_business_data_service),
) -> dict:
    """Calculate statistics for an inclusive date range.

    Repeated query parameters are supported, e.g. ?product_ids=1&product_ids=3.
    Weekday numbering follows Python: Monday=0 through Sunday=6.
    """
    try:
        filters = Filters(
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
