-- ============================================================================
-- SmartCore SiteSnap — Simplify permissions to two tiers.
-- Drops the per-employee permission-grants system and the 'manager' partial
-- tier entirely. Access is now pure role logic: owners/admins/administrators
-- get full access, everyone else gets the fixed employee set (view projects,
-- capture media). No per-employee overrides.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sitesnap_default_permissions(p_role text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT CASE
    WHEN p_role IN ('owner', 'admin', 'administrator') THEN ARRAY[
      'sitesnap.view_projects','sitesnap.manage_projects','sitesnap.capture_media','sitesnap.delete_media',
      'sitesnap.manage_checklists','sitesnap.manage_tasks','sitesnap.manage_team','sitesnap.manage_settings',
      'sitesnap.export_reports'
    ]
    ELSE ARRAY['sitesnap.view_projects','sitesnap.capture_media']
  END;
$$;

CREATE OR REPLACE FUNCTION public.sitesnap_has_permission(p_company_id uuid, p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.core_employees ce
    WHERE ce.auth_user_id = auth.uid()
      AND ce.company_id = p_company_id
      AND ce.auth_user_id IS NOT NULL
      AND (
        ce.role IN ('owner', 'admin', 'administrator')
        OR p_permission = ANY(public.sitesnap_default_permissions(ce.role))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.sitesnap_my_permissions(p_company_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.sitesnap_default_permissions(ce.role)
  FROM public.core_employees ce
  WHERE ce.auth_user_id = auth.uid() AND ce.company_id = p_company_id AND ce.auth_user_id IS NOT NULL
  LIMIT 1;
$$;

DROP TABLE IF EXISTS public.sitesnap_permission_grants CASCADE;
