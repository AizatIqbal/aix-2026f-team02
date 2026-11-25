"""Safely reset PointNull's DEMO database to a new, uninitialized workspace.

Run from project/backend after configuring backend/.env:
    APP_ENV=demo
    RESET_DEMO_DATA=true
    DEMO_DATABASE_URL=... (demo Supabase connection)
    PRODUCTION_DATABASE_URL=... (production Supabase connection)

Then run:
    python scripts/reset_demo_data.py --confirm-demo-reset

This script refuses to run outside APP_ENV=demo, unless the explicit reset flag
is true, or when the demo and production database targets appear identical.
"""

from __future__ import annotations

import argparse
import os
import sys

from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.db.database_manager import APP_ENV, DatabaseManager


def _database_identity(raw_url: str) -> tuple[str | None, int | None, str | None]:
    parsed = make_url(raw_url)
    return parsed.host, parsed.port, parsed.database


def main() -> int:
    parser = argparse.ArgumentParser(description="Reset the isolated PointNull demo database.")
    parser.add_argument(
        "--confirm-demo-reset",
        action="store_true",
        help="Explicitly confirm that all demo business data should be deleted.",
    )
    args = parser.parse_args()

    if APP_ENV != "demo":
        print("Refusing to reset: APP_ENV must be exactly 'demo'.", file=sys.stderr)
        return 2

    if os.getenv("RESET_DEMO_DATA", "false").strip().lower() not in {"1", "true", "yes"}:
        print("Refusing to reset: set RESET_DEMO_DATA=true in backend/.env first.", file=sys.stderr)
        return 2

    if not args.confirm_demo_reset:
        print("Refusing to reset: add --confirm-demo-reset to confirm this destructive action.", file=sys.stderr)
        return 2

    demo_url = os.getenv("DEMO_DATABASE_URL", "").strip()
    production_url = (
        os.getenv("PRODUCTION_DATABASE_URL", "").strip()
        or os.getenv("DATABASE_URL", "").strip()
    )
    if not demo_url or not production_url:
        print(
            "Refusing to reset: both DEMO_DATABASE_URL and PRODUCTION_DATABASE_URL (or DATABASE_URL) must be configured so their targets can be compared.",
            file=sys.stderr,
        )
        return 2

    try:
        if _database_identity(demo_url) == _database_identity(production_url):
            print("Refusing to reset: demo and production URLs point to the same host/database.", file=sys.stderr)
            return 2
    except Exception as exc:
        print(f"Refusing to reset: could not validate database targets ({exc}).", file=sys.stderr)
        return 2

    db = DatabaseManager()
    try:
        with db.engine.begin() as connection:
            # These are PointNull business/data tables. CASCADE handles related
            # foreign-key dependants; RESTART IDENTITY resets generated IDs.
            connection.execute(text("""
                TRUNCATE TABLE
                    currency_migration_campaign_snapshot,
                    currency_migration_product_snapshot,
                    currency_migration,
                    currency_rate_snapshot,
                    translation_memory,
                    order_item,
                    orders,
                    campaign,
                    product,
                    category,
                    customer
                RESTART IDENTITY CASCADE
            """))
            connection.execute(text("""
                INSERT INTO pointnull_settings
                    (setting_id, operating_currency, currency_initialized, updated_at)
                VALUES (1, 'KRW', FALSE, NOW())
                ON CONFLICT (setting_id) DO UPDATE
                SET operating_currency = 'KRW',
                    currency_initialized = FALSE,
                    updated_at = NOW()
            """))

        print("Demo database reset completed.")
        print("Business tables are empty; first-time currency setup will appear on next app load.")
        print("No schema was dropped. Production database was not selected.")
        return 0
    except Exception as exc:
        print(f"Demo reset failed and was rolled back: {exc}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
