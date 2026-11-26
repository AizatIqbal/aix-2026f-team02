"""Business-currency settings, Frankfurter reference rates, and atomic migration."""

from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.db.database_manager import DatabaseManager

router = APIRouter(prefix="/api/v1/currency", tags=["currency"])
CurrencyCode = Literal["KRW", "MYR", "USD"]
FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rates"


class CurrencyInitializeRequest(BaseModel):
    currency: CurrencyCode


class CurrencyPreviewRequest(BaseModel):
    target_currency: CurrencyCode


class CurrencyChangeRequest(BaseModel):
    target_currency: CurrencyCode
    confirmed: bool = False
    # Optional override is useful for a documented business-agreed rate.
    # The chosen value and method are saved in the migration audit record.
    exchange_rate_override: Decimal | None = Field(default=None, gt=0, max_digits=20, decimal_places=10)


def _round_amount(value: Decimal, currency: str) -> Decimal:
    quantum = Decimal("1") if currency == "KRW" else Decimal("0.01")
    return value.quantize(quantum, rounding=ROUND_HALF_UP)


def _fetch_reference_rate(base: str, quote: str) -> tuple[Decimal, date, str]:
    if base == quote:
        return Decimal("1"), date.today(), "identity"
    try:
        response = httpx.get(
            FRANKFURTER_URL,
            params={"base": base, "quotes": quote},
            headers={"Accept": "application/json"},
            timeout=8.0,
        )
        response.raise_for_status()
        rows = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=503,
            detail="The reference exchange-rate service is temporarily unavailable. No currency change was made.",
        ) from exc

    try:
        matching = [
            row for row in rows
            if row.get("base") == base and row.get("quote") == quote
            and row.get("rate") is not None and Decimal(str(row["rate"])) > 0
        ]
        if not matching:
            raise HTTPException(status_code=503, detail="No reference exchange rate was returned for this currency pair.")
        row = max(matching, key=lambda item: item.get("date", ""))
        rate = Decimal(str(row["rate"]))
        rate_date = date.fromisoformat(row["date"])
        if not rate.is_finite() or rate <= 0:
            raise ValueError("The rate must be a positive finite number")
    except HTTPException:
        raise
    except (ValueError, ArithmeticError, KeyError, TypeError, AttributeError) as exc:
        raise HTTPException(status_code=502, detail="The exchange-rate response was invalid.") from exc
    return rate, rate_date, "Frankfurter"


def _current_currency(connection, lock: bool = False) -> str:
    query = "SELECT operating_currency, currency_initialized FROM pointnull_settings WHERE setting_id = 1"
    if lock:
        query += " FOR UPDATE"
    row = connection.execute(text(query)).mappings().first()
    if not row:
        raise HTTPException(status_code=503, detail="Business currency settings are not initialized. Apply the currency database migrations.")
    if not row["currency_initialized"]:
        raise HTTPException(status_code=409, detail="Complete first-time currency setup before using currency migration features.")
    return row["operating_currency"]


def _product_preview_rows(connection, current: str, target: str) -> list[dict]:
    return [dict(row) for row in connection.execute(text("""
        SELECT
            p.product_id, p.product_name, p.price, p.price_updated_at,
            (
                SELECT s.original_price
                FROM currency_migration_product_snapshot s
                JOIN currency_migration m ON m.migration_id = s.migration_id
                WHERE s.product_id = p.product_id
                  AND m.from_currency = :target_currency
                  AND m.to_currency = :current_currency
                ORDER BY m.migrated_at DESC, m.migration_id DESC
                LIMIT 1
            ) AS restorable_price,
            (
                SELECT s.converted_price_updated_at
                FROM currency_migration_product_snapshot s
                JOIN currency_migration m ON m.migration_id = s.migration_id
                WHERE s.product_id = p.product_id
                  AND m.from_currency = :target_currency
                  AND m.to_currency = :current_currency
                ORDER BY m.migrated_at DESC, m.migration_id DESC
                LIMIT 1
            ) AS restorable_at
        FROM product p
        ORDER BY p.product_id
    """), {"current_currency": current, "target_currency": target}).mappings().all()]


def _campaign_preview_rows(connection, current: str, target: str) -> list[dict]:
    return [dict(row) for row in connection.execute(text("""
        SELECT
            c.promocode, c.campaign_name, c.budget, c.discount_value, c.updated_at,
            (
                SELECT s.original_budget
                FROM currency_migration_campaign_snapshot s
                JOIN currency_migration m ON m.migration_id = s.migration_id
                WHERE s.promocode = c.promocode
                  AND m.from_currency = :target_currency
                  AND m.to_currency = :current_currency
                ORDER BY m.migrated_at DESC, m.migration_id DESC
                LIMIT 1
            ) AS restorable_budget,
            (
                SELECT s.original_discount_value
                FROM currency_migration_campaign_snapshot s
                JOIN currency_migration m ON m.migration_id = s.migration_id
                WHERE s.promocode = c.promocode
                  AND m.from_currency = :target_currency
                  AND m.to_currency = :current_currency
                ORDER BY m.migrated_at DESC, m.migration_id DESC
                LIMIT 1
            ) AS restorable_discount,
            (
                SELECT s.converted_updated_at
                FROM currency_migration_campaign_snapshot s
                JOIN currency_migration m ON m.migration_id = s.migration_id
                WHERE s.promocode = c.promocode
                  AND m.from_currency = :target_currency
                  AND m.to_currency = :current_currency
                ORDER BY m.migrated_at DESC, m.migration_id DESC
                LIMIT 1
            ) AS restorable_at
        FROM campaign c
        ORDER BY c.promocode
    """), {"current_currency": current, "target_currency": target}).mappings().all()]


@router.get("")
def get_currency_settings():
    db = DatabaseManager()
    try:
        setting = db.fetch_one(
            "SELECT operating_currency, currency_initialized, updated_at FROM pointnull_settings WHERE setting_id = 1"
        )
        if not setting:
            raise HTTPException(status_code=503, detail="Business currency settings are not initialized. Apply the currency database migrations.")
        return {
            "currency": setting["operating_currency"],
            "initialized": bool(setting["currency_initialized"]),
            "supported_currencies": ["KRW", "MYR", "USD"],
            "updated_at": setting["updated_at"],
            "rate_provider": "Frankfurter",
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Currency database migration has not been applied.") from exc
    finally:
        db.close()


@router.post("/initialize")
def initialize_business_currency(request: CurrencyInitializeRequest):
    """Set the first operating currency without converting any existing amounts."""
    db = DatabaseManager()
    try:
        with db.engine.begin() as connection:
            row = connection.execute(text("""
                SELECT operating_currency, currency_initialized
                FROM pointnull_settings
                WHERE setting_id = 1
                FOR UPDATE
            """)).mappings().first()
            if not row:
                raise HTTPException(status_code=503, detail="Business currency settings are missing. Apply the currency database migrations.")
            if row["currency_initialized"]:
                raise HTTPException(status_code=409, detail="Business currency has already been initialized.")

            # Initial setup is only valid for an empty workspace. This prevents
            # an uninitialized flag from being used to reinterpret existing data.
            counts = connection.execute(text("""
                SELECT
                    (SELECT COUNT(*) FROM product) AS products,
                    (SELECT COUNT(*) FROM orders) AS orders,
                    (SELECT COUNT(*) FROM customer) AS customers,
                    (SELECT COUNT(*) FROM campaign) AS campaigns
            """)).mappings().one()
            if any(int(counts[key]) > 0 for key in ("products", "orders", "customers", "campaigns")):
                raise HTTPException(status_code=409, detail="First-time currency setup is only available before business data is added. Use Settings to change currency instead.")

            connection.execute(text("""
                UPDATE pointnull_settings
                SET operating_currency = :currency, currency_initialized = TRUE, updated_at = NOW()
                WHERE setting_id = 1
            """), {"currency": request.currency})

        return {"currency": request.currency, "initialized": True, "changed": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Could not initialize the business currency.") from exc
    finally:
        db.close()


@router.get("/rate")
def get_reference_rate(base_currency: CurrencyCode, quote_currency: CurrencyCode):
    rate, rate_date, provider = _fetch_reference_rate(base_currency, quote_currency)
    if provider != "identity":
        db = DatabaseManager()
        try:
            db.execute_query("""
                INSERT INTO currency_rate_snapshot
                    (base_currency, quote_currency, rate, rate_date, provider)
                VALUES (:base, :quote, :rate, :rate_date, :provider)
                ON CONFLICT (base_currency, quote_currency, rate_date, provider)
                DO UPDATE SET rate = EXCLUDED.rate, fetched_at = NOW()
            """, {"base": base_currency, "quote": quote_currency, "rate": rate,
                  "rate_date": rate_date, "provider": provider})
        finally:
            db.close()
    return {"base_currency": base_currency, "quote_currency": quote_currency,
            "rate": str(rate), "rate_date": rate_date.isoformat(), "provider": provider}


@router.post("/preview")
def preview_currency_change(request: CurrencyPreviewRequest):
    db = DatabaseManager()
    try:
        with db.engine.connect() as connection:
            current = _current_currency(connection)
            target = request.target_currency
            if target == current:
                return {"current_currency": current, "target_currency": target,
                        "rate": "1", "rate_date": date.today().isoformat(),
                        "provider": "identity", "products": [], "campaigns": [],
                        "product_count": 0, "campaign_count": 0,
                        "products_restored": 0, "products_converted": 0,
                        "campaigns_restored": 0, "campaigns_converted": 0,
                        "historical_orders_unchanged": True,
                        "reporting_note": "Original order amounts remain unchanged."}
            rate, rate_date, provider = _fetch_reference_rate(current, target)
            products = _product_preview_rows(connection, current, target)
            campaigns = _campaign_preview_rows(connection, current, target)
            product_results = []
            for row in products:
                restore = row["restorable_at"] is not None and row["price_updated_at"] == row["restorable_at"]
                new_price = Decimal(str(row["restorable_price"])) if restore else _round_amount(Decimal(str(row["price"])) * rate, target)
                product_results.append({"product_id": row["product_id"], "product_name": row["product_name"],
                                        "current_price": str(row["price"]), "new_price": str(new_price),
                                        "action": "restore_previous_price" if restore else "convert"})
            campaign_results = []
            for row in campaigns:
                restore = row["restorable_at"] is not None and row["updated_at"] == row["restorable_at"]
                new_budget = Decimal(str(row["restorable_budget"])) if restore else _round_amount(Decimal(str(row["budget"])) * rate, target)
                new_discount = Decimal(str(row["restorable_discount"])) if restore else _round_amount(Decimal(str(row["discount_value"])) * rate, target)
                campaign_results.append({"promocode": row["promocode"], "campaign_name": row["campaign_name"],
                                         "current_budget": str(row["budget"]), "new_budget": str(new_budget),
                                         "current_discount": str(row["discount_value"]), "new_discount": str(new_discount),
                                         "action": "restore_previous_amounts" if restore else "convert"})
            return {
                "current_currency": current, "target_currency": target,
                "rate": str(rate), "rate_date": rate_date.isoformat(), "provider": provider,
                "product_count": len(product_results), "campaign_count": len(campaign_results),
                "products_restored": sum(item["action"] == "restore_previous_price" for item in product_results),
                "products_converted": sum(item["action"] == "convert" for item in product_results),
                "campaigns_restored": sum(item["action"] == "restore_previous_amounts" for item in campaign_results),
                "campaigns_converted": sum(item["action"] == "convert" for item in campaign_results),
                "products": product_results, "campaigns": campaign_results,
                "historical_orders_unchanged": True,
                "reporting_note": "Original order amounts remain unchanged; reporting amounts are recalculated using this recorded migration rate.",
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Could not build the currency migration preview.") from exc
    finally:
        db.close()


@router.post("/change")
def change_business_currency(request: CurrencyChangeRequest):
    if not request.confirmed:
        raise HTTPException(status_code=400, detail="Explicit confirmation is required before changing business currency.")

    db = DatabaseManager()
    try:
        # A settings-row lock serializes currency changes. All amount updates,
        # snapshots, audit entries, and the operating-currency update commit together.
        with db.engine.begin() as connection:
            current = _current_currency(connection, lock=True)
            if current == request.target_currency:
                return {"currency": current, "changed": False, "message": "The selected currency is already active."}

            if request.exchange_rate_override is not None:
                rate = request.exchange_rate_override
                rate_date = date.today()
                provider = "manual"
                method = "manual_rate"
            else:
                rate, rate_date, provider = _fetch_reference_rate(current, request.target_currency)
                method = "reference_rate"

            # Re-read price and campaign rows after acquiring the lock. The preview
            # is informational; this locked read is the source of truth at commit.
            products = _product_preview_rows(connection, current, request.target_currency)
            campaigns = _campaign_preview_rows(connection, current, request.target_currency)
            migration_id = connection.execute(text("""
                INSERT INTO currency_migration
                    (from_currency, to_currency, exchange_rate, rate_date, rate_provider,
                     migration_method, product_count, campaign_count)
                VALUES (:source, :target, :rate, :rate_date, :provider, :method, :products, :campaigns)
                RETURNING migration_id
            """), {"source": current, "target": request.target_currency, "rate": rate,
                  "rate_date": rate_date, "provider": provider, "method": method,
                  "products": len(products), "campaigns": len(campaigns)}).scalar_one()

            now = datetime.now(timezone.utc)
            for row in products:
                restore = row["restorable_at"] is not None and row["price_updated_at"] == row["restorable_at"]
                old_price = Decimal(str(row["price"]))
                new_price = Decimal(str(row["restorable_price"])) if restore else _round_amount(old_price * rate, request.target_currency)
                updated_at = now
                connection.execute(text("""
                    UPDATE product SET price = :price, price_updated_at = :updated_at
                    WHERE product_id = :product_id
                """), {"price": new_price, "updated_at": updated_at, "product_id": row["product_id"]})
                connection.execute(text("""
                    INSERT INTO currency_migration_product_snapshot
                        (migration_id, product_id, original_price, converted_price, converted_price_updated_at)
                    VALUES (:migration_id, :product_id, :original_price, :converted_price, :updated_at)
                """), {"migration_id": migration_id, "product_id": row["product_id"],
                      "original_price": old_price, "converted_price": new_price, "updated_at": updated_at})

            for row in campaigns:
                restore = row["restorable_at"] is not None and row["updated_at"] == row["restorable_at"]
                old_budget = Decimal(str(row["budget"]))
                old_discount = Decimal(str(row["discount_value"]))
                new_budget = Decimal(str(row["restorable_budget"])) if restore else _round_amount(old_budget * rate, request.target_currency)
                new_discount = Decimal(str(row["restorable_discount"])) if restore else _round_amount(old_discount * rate, request.target_currency)
                connection.execute(text("""
                    UPDATE campaign SET budget = :budget, discount_value = :discount, updated_at = :updated_at
                    WHERE promocode = :promocode
                """), {"budget": new_budget, "discount": new_discount, "updated_at": now,
                      "promocode": row["promocode"]})
                connection.execute(text("""
                    INSERT INTO currency_migration_campaign_snapshot
                        (migration_id, promocode, original_budget, original_discount_value,
                         converted_budget, converted_discount_value, converted_updated_at)
                    VALUES (:migration_id, :promocode, :original_budget, :original_discount,
                            :converted_budget, :converted_discount, :updated_at)
                """), {"migration_id": migration_id, "promocode": row["promocode"],
                      "original_budget": old_budget, "original_discount": old_discount,
                      "converted_budget": new_budget, "converted_discount": new_discount,
                      "updated_at": now})

            target_digits = 0 if request.target_currency == "KRW" else 2
            # Original orders/order_items are immutable. Only the separate
            # reporting snapshots are multiplied into the new reporting currency.
            connection.execute(text("""
                UPDATE orders
                SET reporting_total = ROUND(reporting_total * :rate, :digits),
                    reporting_discount = ROUND(reporting_discount * :rate, :digits),
                    reporting_currency_code = :target
                WHERE reporting_currency_code = :source
            """), {"rate": rate, "digits": target_digits,
                  "target": request.target_currency, "source": current})
            connection.execute(text("""
                UPDATE order_item
                SET reporting_price = ROUND(reporting_price * :rate, :digits),
                    reporting_currency_code = :target
                WHERE reporting_currency_code = :source
            """), {"rate": rate, "digits": target_digits,
                  "target": request.target_currency, "source": current})
            connection.execute(text("""
                UPDATE orders o
                SET reporting_total = ROUND(
                    COALESCE((
                        SELECT SUM(oi.reporting_price * oi.quantity)
                        FROM order_item oi
                        WHERE oi.order_id = o.order_id
                    ), o.reporting_total * :rate) - o.reporting_discount,
                    :digits
                )
                WHERE o.reporting_currency_code = :target
            """), {"rate": rate, "digits": target_digits, "target": request.target_currency})

            connection.execute(text("""
                INSERT INTO currency_rate_snapshot
                    (base_currency, quote_currency, rate, rate_date, provider)
                VALUES (:base, :quote, :rate, :rate_date, :provider)
                ON CONFLICT (base_currency, quote_currency, rate_date, provider)
                DO UPDATE SET rate = EXCLUDED.rate, fetched_at = NOW()
            """), {"base": current, "quote": request.target_currency, "rate": rate,
                  "rate_date": rate_date, "provider": provider})
            connection.execute(text("""
                UPDATE pointnull_settings
                SET operating_currency = :currency, updated_at = NOW()
                WHERE setting_id = 1
            """), {"currency": request.target_currency})

        return {"currency": request.target_currency, "changed": True,
                "migration_id": int(migration_id), "from_currency": current,
                "to_currency": request.target_currency, "exchange_rate": str(rate),
                "rate_date": rate_date.isoformat(), "rate_provider": provider,
                "products_migrated": len(products), "campaigns_migrated": len(campaigns),
                "historical_transactions_rewritten": False}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Currency migration failed. All changes were rolled back.") from exc
    finally:
        db.close()


@router.get("/history")
def get_currency_migration_history():
    db = DatabaseManager()
    try:
        return db.fetch_all("""
            SELECT migration_id, from_currency, to_currency, exchange_rate,
                   rate_date, rate_provider, migration_method, product_count,
                   campaign_count, migrated_at
            FROM currency_migration
            ORDER BY migrated_at DESC, migration_id DESC
            LIMIT 50
        """)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Currency migration history is unavailable.") from exc
    finally:
        db.close()
