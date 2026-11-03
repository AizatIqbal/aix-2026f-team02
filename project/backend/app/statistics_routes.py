"""HTTP access to the existing business data service."""

from collections.abc import Iterator
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError

from .analytics import Filters
from .business_data_service import BusinessDataService
from .db.business_data_handler import MySQLBusinessDataHandler
from .db.database_manager import DatabaseManager


router = APIRouter(prefix="/api/v1", tags=["statistics"])


def get_business_data_service() -> Iterator[BusinessDataService]:
    """Give each request its own manager and always close its connection."""
    try:
        db = DatabaseManager()
    except (RuntimeError, ValueError, SQLAlchemyError) as exc:
        raise HTTPException(
            status_code=503,
            detail="Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME in backend/.env.",
        ) from exc
    try:
        yield BusinessDataService(MySQLBusinessDataHandler(db))
    finally:
        db.close()


@router.get("/statistics")
def get_statistics(
    start: date,
    end: date,
    group: Literal["day", "week", "month", "year"] = "day",
    service: BusinessDataService = Depends(get_business_data_service),
) -> dict:
    """Calculate statistics from stored sales for the inclusive date range."""
    try:
        filters = Filters(start=start, end=end, group=group)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        return service.get_statistics(filters)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=503,
            detail="The statistics database is unavailable. Check the server connection settings.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail="Cannot analyze the current records. Check stored sales data or select a smaller date range.",
        ) from exc
