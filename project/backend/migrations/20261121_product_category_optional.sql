-- Allow a product to exist without a category.
-- Existing category assignments and product IDs are preserved.
-- Run this once against the Supabase PostgreSQL project before deploying
-- the backend/frontend changes that send or read NULL category_id values.

ALTER TABLE public.product
    ALTER COLUMN category_id DROP NOT NULL;

COMMENT ON COLUMN public.product.category_id IS
    'Optional category assignment; NULL means the product is uncategorized.';
