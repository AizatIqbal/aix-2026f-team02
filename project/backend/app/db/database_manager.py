
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL


# Load environment variables from backend/.env
BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")


@lru_cache(maxsize=8)
def _get_engine(database_url: URL):
    """Create one reusable SQLAlchemy engine per database configuration."""
    return create_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        pool_recycle=1800,
        echo=False,
    )


class DatabaseManager:
    """Manages database access through a shared, reusable connection pool."""

    def __init__(self):
        if not os.getenv("DB_PASSWORD"):
            raise RuntimeError("DB_PASSWORD is missing from backend/.env")

        database_url = URL.create(
            drivername="mysql+pymysql",
            username=os.getenv("DB_USER", "root"),
            password=os.getenv("DB_PASSWORD"),
            host=os.getenv("DB_HOST", "localhost"),
            port=int(os.getenv("DB_PORT", "3306")),
            database=os.getenv("DB_NAME", "business_management"),
            query={"charset": "utf8mb4"},
        )
        self.engine = _get_engine(database_url)

    def connect(self):
        """Test the database connection."""
        with self.engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        return True

    def execute_query(self, query: str, params=None):
        """Execute a parameterized SQL query."""
        with self.engine.begin() as connection:
            result = connection.execute(text(query), params or {})
            return result.rowcount

    def fetch_all(self, query: str, params=None):
        """Execute a query and return all result rows."""
        with self.engine.connect() as connection:
            result = connection.execute(text(query), params or {})
            return [dict(row) for row in result.mappings().all()]

    def fetch_one(self, query: str, params=None):
        """Execute a query and return one result row."""
        with self.engine.connect() as connection:
            result = connection.execute(text(query), params or {})
            row = result.mappings().first()
            return dict(row) if row else None

    def close(self):
        """Release request usage while keeping the shared pool warm.

        Individual operations use context-managed SQLAlchemy connections, so
        each connection is returned to the pool as soon as the query finishes.
        Disposing the engine here would recreate the pool on every API request.
        """
        return None
