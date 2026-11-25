-- Track whether the owner has completed first-time business currency setup.
-- Existing workspaces are treated as initialized because the preceding currency
-- migration assigned their existing records KRW. New/empty demo workspaces are
-- marked uninitialized by scripts/reset_demo_data.py.

ALTER TABLE pointnull_settings
    ADD COLUMN IF NOT EXISTS currency_initialized BOOLEAN NOT NULL DEFAULT TRUE;

-- Existing settings rows keep their current currency and are marked initialized.
UPDATE pointnull_settings
SET currency_initialized = TRUE
WHERE currency_initialized IS NULL;
