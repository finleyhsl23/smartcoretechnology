-- ============================================================================
-- SmartCore SiteSnap — retire the old sitestamp_* objects now that their
-- data has been copied into sitesnap_* and the catalog/entitlement rows
-- have been repointed. Storage policies are dropped first since they
-- reference the functions being dropped below.
-- ============================================================================

DROP POLICY IF EXISTS sitestamp_media_storage_select ON storage.objects;
DROP POLICY IF EXISTS sitestamp_media_storage_insert ON storage.objects;
DROP POLICY IF EXISTS sitestamp_media_storage_delete ON storage.objects;

DROP TABLE IF EXISTS
  public.sitestamp_media_comments,
  public.sitestamp_media_tags,
  public.sitestamp_project_checklist_items,
  public.sitestamp_project_checklists,
  public.sitestamp_checklist_template_items,
  public.sitestamp_checklist_templates,
  public.sitestamp_daily_logs,
  public.sitestamp_tasks,
  public.sitestamp_media,
  public.sitestamp_project_members,
  public.sitestamp_tags,
  public.sitestamp_projects,
  public.sitestamp_webhooks,
  public.sitestamp_api_keys,
  public.sitestamp_settings,
  public.sitestamp_audit_logs,
  public.sitestamp_permission_grants
CASCADE;

DROP FUNCTION IF EXISTS public.sitestamp_default_permissions(text);
DROP FUNCTION IF EXISTS public.sitestamp_current_employee(uuid);
DROP FUNCTION IF EXISTS public.sitestamp_current_employee_id(uuid);
DROP FUNCTION IF EXISTS public.sitestamp_has_permission(uuid, text);
DROP FUNCTION IF EXISTS public.sitestamp_module_enabled(uuid);
DROP FUNCTION IF EXISTS public.sitestamp_my_permissions(uuid);
DROP FUNCTION IF EXISTS public.sitestamp_can_access_project(uuid);
DROP FUNCTION IF EXISTS public.sitestamp_media_guard_update();
DROP FUNCTION IF EXISTS public.sitestamp_tasks_track_completion();
