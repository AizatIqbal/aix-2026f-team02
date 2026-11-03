"""HTTP access to the existing business data service."""

import os
from collections.abc import Iterator
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from mysql.connector import Error as MySQLError

from .analytics import Filters
from .business_data_service import BusinessDataService
from .db.business_data_handler import MySQLBusinessDataHandler
from .db.database_manager import DatabaseManager


router = APIRouter(prefix="/api/v1", tags=["statistics"])


def get_business_data_service() -> Iterator[BusinessDataService]:
    """Give each request its own manager and always close its connection."""
    user = os.getenv("MYSQL_USER")
    password = os.getenv("MYSQL_PASSWORD")
    if not user or password is None:
        raise HTTPException(
            status_code=503,
            detail="Configure MYSQL_USER and MYSQL_PASSWORD before starting the server.",
        )
    try:
        port = int(os.getenv("MYSQL_PORT", "3306"))
        if not 1 <= port <= 65535:
            raise ValueError("Port is outside the valid range")
    except ValueError as exc:
        raise HTTPException(status_code=503, detail="MYSQL_PORT must be a valid port number.") from exc

    db = DatabaseManager(
        user=user,
        password=password,
        host=os.getenv("MYSQL_HOST", "127.0.0.1"),
        port=port,
        database=os.getenv("MYSQL_DATABASE", "pos_database_mysql"),
    )
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
    except MySQLError as exc:
        raise HTTPException(
            status_code=503,
            detail="The statistics database is unavailable. Check the server connection settings.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail="Cannot analyze the current records. Check stored sales data or select a smaller date range.",
        ) from exc
