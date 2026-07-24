-- ============================================================================
-- SmartCore SiteStamp — grant access to SmartCore Technology LTD
-- (company_id b9298a9b-a910-4ba9-9a57-72db43b3b3d7, owner demo1@smartcoretechnology.co.uk)
-- Two rows are required: smartcore_core_purchased_modules drives the tile on
-- /modules/, company_modules is the module's own internal entitlement gate
-- (sitestamp_module_enabled / requireSiteStampAccess). Neither table has a
-- unique constraint on (company_id, module_slug/module_key), so idempotency
-- is guarded explicitly rather than via ON CONFLICT — same pattern used for
-- the SmartFits engineer-audit and internal SiteStamp QA grants.
-- ============================================================================

INSERT INTO public.smartcore_core_purchased_modules (company_id, module_slug, module_name, billing_type, status)
SELECT 'b9298a9b-a910-4ba9-9a57-72db43b3b3d7', 'sitestamp', 'SiteStamp', 'monthly', 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.smartcore_core_purchased_modules
  WHERE company_id = 'b9298a9b-a910-4ba9-9a57-72db43b3b3d7' AND module_slug = 'sitestamp'
);

INSERT INTO public.company_modules (company_id, module_key, enabled)
SELECT 'b9298a9b-a910-4ba9-9a57-72db43b3b3d7', 'sitestamp', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.company_modules
  WHERE company_id = 'b9298a9b-a910-4ba9-9a57-72db43b3b3d7' AND module_key = 'sitestamp'
);
