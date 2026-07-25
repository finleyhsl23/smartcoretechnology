-- ============================================================================
-- SmartCore SiteSnap — copy existing sitestamp_* data into the new sitesnap_*
-- tables (same column layout, just renamed), and repoint the module catalog
-- / entitlement rows from the 'sitestamp' slug/key to 'sitesnap'.
-- ============================================================================

INSERT INTO public.sitesnap_projects SELECT * FROM public.sitestamp_projects;
INSERT INTO public.sitesnap_media SELECT * FROM public.sitestamp_media;
INSERT INTO public.sitesnap_project_members SELECT * FROM public.sitestamp_project_members;
INSERT INTO public.sitesnap_tags SELECT * FROM public.sitestamp_tags;
INSERT INTO public.sitesnap_media_tags SELECT * FROM public.sitestamp_media_tags;
INSERT INTO public.sitesnap_media_comments SELECT * FROM public.sitestamp_media_comments;
INSERT INTO public.sitesnap_checklist_templates SELECT * FROM public.sitestamp_checklist_templates;
INSERT INTO public.sitesnap_checklist_template_items SELECT * FROM public.sitestamp_checklist_template_items;
INSERT INTO public.sitesnap_project_checklists SELECT * FROM public.sitestamp_project_checklists;
INSERT INTO public.sitesnap_project_checklist_items SELECT * FROM public.sitestamp_project_checklist_items;
INSERT INTO public.sitesnap_daily_logs SELECT * FROM public.sitestamp_daily_logs;
INSERT INTO public.sitesnap_tasks SELECT * FROM public.sitestamp_tasks;
INSERT INTO public.sitesnap_permission_grants SELECT * FROM public.sitestamp_permission_grants;
INSERT INTO public.sitesnap_settings SELECT * FROM public.sitestamp_settings;
INSERT INTO public.sitesnap_webhooks SELECT * FROM public.sitestamp_webhooks;
INSERT INTO public.sitesnap_api_keys SELECT * FROM public.sitestamp_api_keys;
INSERT INTO public.sitesnap_audit_logs SELECT * FROM public.sitestamp_audit_logs;

-- Repoint the marketplace catalog row in place (keeps its id / created_at /
-- purchase history intact rather than inserting a duplicate row).
UPDATE public.marketplace_modules
SET
  slug = 'sitesnap',
  name = 'SiteSnap',
  long_description = replace(long_description, 'SiteStamp', 'SiteSnap')
WHERE slug = 'sitestamp';

UPDATE public.company_modules
SET module_key = 'sitesnap'
WHERE module_key = 'sitestamp';

UPDATE public.smartcore_core_purchased_modules
SET module_slug = 'sitesnap', module_name = 'SiteSnap'
WHERE module_slug = 'sitestamp';
