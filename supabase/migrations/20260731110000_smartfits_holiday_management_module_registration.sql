-- ============================================================================
-- Register "SmartFits Holiday Management" as a module tile for Smartfits
-- Installations Ltd only. Unlike the other Smartfits bespoke modules, this
-- one isn't hosted in this repo — it's a standalone Cloudflare Pages
-- deployment at smartfitsinstallationsltd.smartcoretechnology.pages.dev, so
-- there is no internal company_modules-gated app page here; the /modules/
-- tile is a plain external link, and this migration only exists to make the
-- tile show up (and only for Smartfits).
-- ============================================================================

INSERT INTO public.marketplace_modules (slug, name, category, short_description, status)
VALUES (
  'smartfits-holiday-management',
  'SmartFits Holiday Management',
  'Operations',
  'Leave requests, approvals & team calendar for Smartfits Installations Ltd.',
  'draft'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.smartcore_core_purchased_modules (company_id, module_slug, module_name, billing_type, status)
SELECT '34c3dc62-25dc-4159-b159-ae7b24479bee', 'smartfits-holiday-management', 'SmartFits Holiday Management', 'monthly', 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.smartcore_core_purchased_modules
  WHERE company_id = '34c3dc62-25dc-4159-b159-ae7b24479bee' AND module_slug = 'smartfits-holiday-management'
);

INSERT INTO public.company_modules (company_id, module_key, enabled)
VALUES (
  '34c3dc62-25dc-4159-b159-ae7b24479bee',
  'smartfits-holiday-management',
  true
)
ON CONFLICT (company_id, module_key) DO NOTHING;
