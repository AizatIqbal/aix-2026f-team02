#!/usr/bin/env python3
"""Copy PointNull's existing MySQL data into an already-created Supabase schema.

Safe by default: without --migrate, this script only checks connections, schemas,
source row counts, and that the target tables are empty. It never prints secrets.

Required environment variables (read from .env.migration or .env):
  MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
  DATABASE_URL  (Supabase PostgreSQL transaction-pooler URL)

Dependencies: PyMySQL, pg8000, python-dotenv
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import time, timedelta
from typing import Any
from urllib.parse import urlsplit, parse_qs, unquote

import pymysql
import pg8000
from dotenv import load_dotenv


# The generated PostgreSQL day_of_week column is intentionally omitted.
BASE_COLUMNS: dict[str, tuple[str, ...]] = {
    "category": ("category_id", "category_name"),
    "customer": ("customer_phone", "customer_name", "customer_age", "customer_gender"),
    "campaign": (
        "promocode",
        "campaign_name",
        "channel",
        "start_date",
        "end_date",
        "budget",
        "discount_value",
    ),
    "product": ("product_id", "category_id", "product_name", "price"),
    "orders": (
        "order_id",
        "order_date",
        "order_time",
        "customer_phone",
        "promocode",
        "discount",
        "total",
    ),
    "order_item": ("order_item_id", "order_id", "product_id", "quantity", "price"),
}

TABLE_ORDER = ("category", "customer", "campaign", "product", "orders", "order_item")

IDENTITY_COLUMNS = {
    "category": "category_id",
    "product": "product_id",
    "orders": "order_id",
    "order_item": "order_item_id",
}

BATCH_SIZE = 1000


def required_env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None or value == "":
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def make_mysql_connection():
    return pymysql.connect(
        host=required_env("MYSQL_HOST", "127.0.0.1"),
        port=int(required_env("MYSQL_PORT", "3306")),
        user=required_env("MYSQL_USER"),
        password=required_env("MYSQL_PASSWORD", ""),
        database=required_env("MYSQL_DATABASE", "business_management"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.Cursor,
        read_timeout=300,
        write_timeout=300,
        autocommit=True,
    )


def make_pg_connection():
    dsn = required_env("DATABASE_URL")
    parsed = urlsplit(dsn)

    if parsed.scheme not in ("postgresql", "postgres"):
        raise RuntimeError(
            "DATABASE_URL must start with postgresql:// or postgres://"
        )

    # Supabase requires TLS. pg8000 uses an SSL context rather than libpq sslmode.
    return pg8000.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        database=parsed.path.lstrip("/"),
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        ssl_context=True,
        timeout=300,
    )


def get_mysql_columns(conn, table: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(f"SHOW COLUMNS FROM `{table}`")
        return {row[0] for row in cur.fetchall()}


def get_source_count(conn, table: str) -> int:
    # The standard buffered cursor keeps the result available while batches
    # are inserted into PostgreSQL; the dataset is small enough to buffer.
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM `{table}`")
        return int(cur.fetchone()[0])


def get_target_count(conn, table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM public.{table}")
        return int(cur.fetchone()[0])


def normalize_value(column: str, value: Any) -> Any:
    # PyMySQL returns MySQL TIME values as timedelta; PostgreSQL TIME expects time.
    if column == "order_time" and isinstance(value, timedelta):
        seconds = value.total_seconds()
        if seconds < 0:
            raise ValueError(
                "Negative order_time values are not supported by this migration script"
            )

        whole = int(seconds)
        micros = value.microseconds
        hours, rem = divmod(whole, 3600)
        minutes, secs = divmod(rem, 60)
        return time(hours % 24, minutes, secs, micros)

    if column == "is_active" and value is not None:
        return bool(value)

    return value


def check_schema(mysql_conn, pg_conn) -> dict[str, tuple[int, int]]:
    report: dict[str, tuple[int, int]] = {}

    for table in TABLE_ORDER:
        src_columns = get_mysql_columns(mysql_conn, table)
        columns = list(BASE_COLUMNS[table])

        # Preserve optional product attributes when they exist in the local DB.
        if table == "product":
            for optional in ("image_url", "is_active"):
                if optional in src_columns:
                    columns.append(optional)

        missing = [column for column in columns if column not in src_columns]
        if missing:
            raise RuntimeError(
                f"MySQL table {table} is missing expected columns: "
                + ", ".join(missing)
            )

        source_count = get_source_count(mysql_conn, table)
        target_count = get_target_count(pg_conn, table)
        report[table] = (source_count, target_count)

    return report


def print_report(report: dict[str, tuple[int, int]]) -> None:
    print("\nPointNull database migration check")
    print("Table         MySQL rows   Supabase rows")
    print("----------------------------------------")

    for table, (source_count, target_count) in report.items():
        print(f"{table:<13} {source_count:>10}   {target_count:>13}")


def copy_table(mysql_conn, pg_conn, table: str) -> int:
    src_columns = get_mysql_columns(mysql_conn, table)
    columns = list(BASE_COLUMNS[table])

    if table == "product":
        for optional in ("image_url", "is_active"):
            if optional in src_columns:
                columns.append(optional)

    # Table and column identifiers come only from the fixed allowlists above.
    # Use MySQL quoting for the source and standard PostgreSQL identifiers for the target.
    select_query = (
        f"SELECT {', '.join(f'`{column}`' for column in columns)} "
        f"FROM `{table}` ORDER BY `{columns[0]}`"
    )

    insert_query = (
        f"INSERT INTO public.{table} ({', '.join(columns)}) "
        f"VALUES ({', '.join(['%s'] * len(columns))})"
    )

    copied = 0

    with mysql_conn.cursor() as src, pg_conn.cursor() as dst:
        src.execute(select_query)

        while True:
            rows = src.fetchmany(BATCH_SIZE)
            if not rows:
                break

            normalized = [
                tuple(
                    normalize_value(column, value)
                    for column, value in zip(columns, row)
                )
                for row in rows
            ]

            dst.executemany(insert_query, normalized)
            copied += len(normalized)
            print(f"  {table}: copied {copied} rows", flush=True)

    return copied


def sync_sequences(pg_conn) -> None:
    with pg_conn.cursor() as cur:
        for table, column in IDENTITY_COLUMNS.items():
            cur.execute(
                f"SELECT setval(pg_get_serial_sequence(%s, %s), "
                f"COALESCE(MAX({column}), 1), MAX({column}) IS NOT NULL) "
                f"FROM public.{table}",
                (f"public.{table}", column),
            )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Safely copy PointNull data from local MySQL to Supabase PostgreSQL."
        )
    )
    parser.add_argument(
        "--migrate",
        action="store_true",
        help=(
            "perform the data copy; without this flag only checks connections "
            "and counts"
        ),
    )
    args = parser.parse_args()

    # Prefer a dedicated migration-only env file; fall back to the backend's .env.
    load_dotenv(".env.migration")
    load_dotenv()

    mysql_conn = None
    pg_conn = None

    try:
        mysql_conn = make_mysql_connection()
        pg_conn = make_pg_connection()

        report = check_schema(mysql_conn, pg_conn)
        print_report(report)

        if not args.migrate:
            print("\nCHECK ONLY: no data was changed.")
            print("Review the row counts, then rerun with --migrate to copy the data.")

            if any(target_count != 0 for _, target_count in report.values()):
                print(
                    "WARNING: one or more Supabase tables are not empty. "
                    "The migration will refuse to run until the target is empty."
                )

            return 0

        nonempty = [
            table
            for table, (_, target_count) in report.items()
            if target_count != 0
        ]

        if nonempty:
            raise RuntimeError(
                "Refusing to import because these Supabase tables are not empty: "
                + ", ".join(nonempty)
                + ". Do not truncate them automatically; inspect/backup first."
            )

        # All data changes occur in one PostgreSQL transaction. On failure, rollback.
        try:
            for table in TABLE_ORDER:
                copied = copy_table(mysql_conn, pg_conn, table)
                expected = report[table][0]

                if copied != expected:
                    raise RuntimeError(
                        f"Row count changed while copying {table}: "
                        f"expected {expected}, copied {copied}"
                    )

            sync_sequences(pg_conn)
            pg_conn.commit()

        except Exception:
            pg_conn.rollback()
            raise

        print("\nMigration committed successfully.")
        print("The MySQL source database was only read; it was not modified.")
        return 0

    except Exception as exc:
        if pg_conn is not None:
            try:
                pg_conn.rollback()
            except Exception:
                pass

        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    finally:
        if mysql_conn is not None:
            mysql_conn.close()

        if pg_conn is not None:
            pg_conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
