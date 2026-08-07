-- ============================================================================
-- SmartCore SiteStamp — publish to the live shop
-- Flips the marketplace_modules row from 'draft' to 'published' so SiteStamp
-- is a real, purchasable module for every SmartCore customer (previously
-- only entitled ad-hoc to specific companies for internal QA/demo).
-- ============================================================================

UPDATE public.marketplace_modules
SET status = 'published'
WHERE slug = 'sitestamp';
