-- PointNull business operating currency and immutable transaction currency support.
-- Apply this migration to the active PostgreSQL/Supabase database before deploying the app.
-- Existing records are treated as KRW because the previous application stored every amount as KRW.

CREATE TABLE IF NOT EXISTS pointnull_settings (
    setting_id SMALLINT PRIMARY KEY CHECK (setting_id = 1),
    operating_currency VARCHAR(3) NOT NULL DEFAULT 'KRW'
        CHECK (operating_currency IN ('KRW', 'MYR', 'USD')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO pointnull_settings (setting_id, operating_currency)
VALUES (1, 'KRW')
ON CONFLICT (setting_id) DO NOTHING;

ALTER TABLE product
    ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE campaign
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Original transaction amounts never change. reporting_* is a derived,
-- auditable value used only for consolidated analytics in the current currency.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NOT NULL DEFAULT 'KRW',
    ADD COLUMN IF NOT EXISTS reporting_currency_code VARCHAR(3) NOT NULL DEFAULT 'KRW',
    ADD COLUMN IF NOT EXISTS reporting_total NUMERIC(14, 2),
    ADD COLUMN IF NOT EXISTS reporting_discount NUMERIC(14, 2);

UPDATE orders
SET reporting_total = COALESCE(reporting_total, total),
    reporting_discount = COALESCE(reporting_discount, discount),
    reporting_currency_code = COALESCE(reporting_currency_code, currency_code, 'KRW')
WHERE reporting_total IS NULL OR reporting_discount IS NULL;

ALTER TABLE orders
    ALTER COLUMN reporting_total SET NOT NULL,
    ALTER COLUMN reporting_discount SET NOT NULL;

-- Each order item's source currency is inherited from its parent order.
ALTER TABLE order_item
    ADD COLUMN IF NOT EXISTS reporting_price NUMERIC(14, 2),
    ADD COLUMN IF NOT EXISTS reporting_currency_code VARCHAR(3) NOT NULL DEFAULT 'KRW';

UPDATE order_item
SET reporting_price = COALESCE(reporting_price, price)
WHERE reporting_price IS NULL;

ALTER TABLE order_item
    ALTER COLUMN reporting_price SET NOT NULL;

CREATE TABLE IF NOT EXISTS currency_rate_snapshot (
    rate_snapshot_id BIGSERIAL PRIMARY KEY,
    base_currency VARCHAR(3) NOT NULL,
    quote_currency VARCHAR(3) NOT NULL,
    rate NUMERIC(20, 10) NOT NULL CHECK (rate > 0),
    rate_date DATE NOT NULL,
    provider VARCHAR(40) NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (base_currency, quote_currency, rate_date, provider)
);

CREATE TABLE IF NOT EXISTS currency_migration (
    migration_id BIGSERIAL PRIMARY KEY,
    from_currency VARCHAR(3) NOT NULL,
    to_currency VARCHAR(3) NOT NULL,
    exchange_rate NUMERIC(20, 10) NOT NULL CHECK (exchange_rate > 0),
    rate_date DATE NOT NULL,
    rate_provider VARCHAR(40) NOT NULL,
    migration_method VARCHAR(20) NOT NULL DEFAULT 'reference_rate'
        CHECK (migration_method IN ('reference_rate', 'manual_rate')),
    product_count INTEGER NOT NULL DEFAULT 0,
    campaign_count INTEGER NOT NULL DEFAULT 0,
    migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_currency_migration_pair CHECK (from_currency <> to_currency)
);

CREATE TABLE IF NOT EXISTS currency_migration_product_snapshot (
    snapshot_id BIGSERIAL PRIMARY KEY,
    migration_id BIGINT NOT NULL REFERENCES currency_migration(migration_id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES product(product_id) ON DELETE RESTRICT,
    original_price NUMERIC(14, 2) NOT NULL,
    converted_price NUMERIC(14, 2) NOT NULL,
    converted_price_updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (migration_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_currency_product_snapshot_product
    ON currency_migration_product_snapshot (product_id, migration_id);

CREATE TABLE IF NOT EXISTS currency_migration_campaign_snapshot (
    snapshot_id BIGSERIAL PRIMARY KEY,
    migration_id BIGINT NOT NULL REFERENCES currency_migration(migration_id) ON DELETE CASCADE,
    promocode VARCHAR(30) NOT NULL,
    original_budget NUMERIC(14, 2) NOT NULL,
    original_discount_value NUMERIC(14, 2) NOT NULL,
    converted_budget NUMERIC(14, 2) NOT NULL,
    converted_discount_value NUMERIC(14, 2) NOT NULL,
    converted_updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (migration_id, promocode)
);

CREATE INDEX IF NOT EXISTS idx_currency_campaign_snapshot_code
    ON currency_migration_campaign_snapshot (promocode, migration_id);

CREATE INDEX IF NOT EXISTS idx_orders_reporting_currency_date
    ON orders (reporting_currency_code, order_date);
