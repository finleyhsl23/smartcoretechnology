-- ============================================================================
-- Register the Vehicle Database module so it appears on /modules/ for
-- Smartfits and gates correctly. Mirrors the pattern used for the Engineer
-- Install Audit module: catalog row kept as 'draft' (not offered in the
-- public shop to other tenants), entitlement recorded in
-- smartcore_core_purchased_modules (drives the /modules/ tile), and
-- company_modules (the module's own internal gate).
-- ============================================================================

INSERT INTO public.marketplace_modules (slug, name, category, short_description, status)
VALUES (
  'smartfits-vehicle-database',
  'Vehicle Installations Database',
  'Operations',
  'Searchable database of every vehicle Smartfits has fitted: reg/VIN lookup, ignition wire colour, CAN bus colours, earth/airbag/ADAS/dashcam/tracker locations with photos, install time and notes.',
  'draft'
)
ON CONFLICT (slug) DO NOTHING;

-- No unique constraint exists on (company_id, module_slug) for this table,
-- so guard idempotency explicitly rather than relying on ON CONFLICT.
INSERT INTO public.smartcore_core_purchased_modules (company_id, module_slug, module_name, billing_type, status)
SELECT '34c3dc62-25dc-4159-b159-ae7b24479bee', 'smartfits-vehicle-database', 'Vehicle Installations Database', 'monthly', 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.smartcore_core_purchased_modules
  WHERE company_id = '34c3dc62-25dc-4159-b159-ae7b24479bee' AND module_slug = 'smartfits-vehicle-database'
);

INSERT INTO public.company_modules (company_id, module_key, enabled)
VALUES (
  '34c3dc62-25dc-4159-b159-ae7b24479bee',
  'smartfits-vehicle-database',
  true
)
ON CONFLICT (company_id, module_key) DO NOTHING;
