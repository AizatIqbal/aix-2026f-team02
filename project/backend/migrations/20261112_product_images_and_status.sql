-- PointNull migration: optional product image URL and product availability.
-- Run this once against the same database used by backend/.env.

ALTER TABLE product
    ADD COLUMN image_url VARCHAR(512) NULL AFTER price,
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER image_url;

-- Existing products remain active by default. Product images are optional.
