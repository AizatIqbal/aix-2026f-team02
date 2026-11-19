import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


# Load environment variables from backend/.env during local development.
BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")


def _build_database_url(raw_database_url: str):
    """Validate a Supabase URL and select the pure-Python pg8000 dialect."""
    try:
        database_url = make_url(raw_database_url)
    except Exception as exc:
        raise RuntimeError("DATABASE_URL is not a valid SQLAlchemy connection URL") from exc

    if database_url.drivername in {"postgres", "postgresql", "postgresql+psycopg"}:
        database_url = database_url.set(drivername="postgresql+pg8000")
    elif database_url.drivername != "postgresql+pg8000":
        raise RuntimeError(
            "DATABASE_URL must use PostgreSQL (postgresql:// or postgresql+pg8000://)"
        )

    # pg8000 uses ssl_context rather than libpq's sslmode option. Enforce TLS
    # through connect_args below and remove sslmode from the URL so it is not
    # passed as an unsupported pg8000 keyword argument.
    if "sslmode" in database_url.query:
        database_url = database_url.difference_update_query(["sslmode"])

    return database_url


@lru_cache(maxsize=8)
def _get_engine(database_url):
    """Create one reusable SQLAlchemy engine per database configuration."""
    return create_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=1,
        max_overflow=0,
        pool_timeout=10,
        pool_recycle=300,
        pool_use_lifo=True,
        # pg8000 is pure Python and avoids the libpq DLL blocked by Windows
        # Application Control. ssl_context=True requires TLS for Supabase.
        connect_args={"ssl_context": True, "timeout": 10},
        echo=False,
    )


class DatabaseManager:
    """Manages PostgreSQL access through a shared, reusable connection pool."""

    def __init__(self):
        raw_database_url = os.getenv("DATABASE_URL", "").strip()
        if not raw_database_url:
            raise RuntimeError("DATABASE_URL is missing from the environment")

        database_url = _build_database_url(raw_database_url)
        self.database_name = database_url.database or "postgres"
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
        """Connections are returned to the shared pool by context managers."""
        return None
