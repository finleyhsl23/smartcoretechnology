-- ============================================================================
-- SmartCore SiteLens — Migration 1: Foundation
-- Job-site photo & video documentation, organised by project. Identity is
-- public.core_employees / public.smartcore_core_companies — the same
-- identity source the Presence & Fire Safety and CRM modules use. Module
-- key: sitelens. Tables are prefixed sitelens_ in the public schema, mirroring
-- the Presence & Fire Safety convention for cross-tenant marketplace modules
-- (as opposed to the single-tenant smartfitsinstallationsltd schema pattern).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Permission grants — additive on top of role-based defaults below; owners
-- and admins always have every permission and cannot be reduced below that
-- floor. Mirrors presence_fire_safety_permission_grants.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitelens_permission_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  permission  text NOT NULL,
  granted_by  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, employee_id, permission)
);
CREATE INDEX IF NOT EXISTS sitelens_permission_grants_employee_idx ON public.sitelens_permission_grants(employee_id);
CREATE INDEX IF NOT EXISTS sitelens_permission_grants_company_idx ON public.sitelens_permission_grants(company_id);

ALTER TABLE public.sitelens_permission_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitelens_permission_grants_select_own_company ON public.sitelens_permission_grants
  FOR SELECT USING (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

CREATE POLICY sitelens_permission_grants_write_admins ON public.sitelens_permission_grants
  FOR ALL USING (
    company_id IN (
      SELECT ce.company_id FROM public.core_employees ce
      WHERE ce.auth_user_id = auth.uid() AND ce.role IN ('owner', 'admin', 'administrator')
    )
  ) WITH CHECK (
    company_id IN (
      SELECT ce.company_id FROM public.core_employees ce
      WHERE ce.auth_user_id = auth.uid() AND ce.role IN ('owner', 'admin', 'administrator')
    )
  );

-- ----------------------------------------------------------------------------
-- Helper functions
-- ----------------------------------------------------------------------------

-- Baseline permission set granted by core role, before explicit grants are added.
CREATE OR REPLACE FUNCTION public.sitelens_default_permissions(p_role text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY[
      'sitelens.view_projects','sitelens.manage_projects','sitelens.capture_media','sitelens.delete_media',
      'sitelens.manage_checklists','sitelens.manage_tasks','sitelens.manage_team','sitelens.manage_settings',
      'sitelens.export_reports'
    ]
    WHEN 'admin' THEN ARRAY[
      'sitelens.view_projects','sitelens.manage_projects','sitelens.capture_media','sitelens.delete_media',
      'sitelens.manage_checklists','sitelens.manage_tasks','sitelens.manage_team','sitelens.manage_settings',
      'sitelens.export_reports'
    ]
    WHEN 'administrator' THEN ARRAY[
      'sitelens.view_projects','sitelens.manage_projects','sitelens.capture_media','sitelens.delete_media',
      'sitelens.manage_checklists','sitelens.manage_tasks','sitelens.manage_team','sitelens.manage_settings',
      'sitelens.export_reports'
    ]
    WHEN 'manager' THEN ARRAY[
      'sitelens.view_projects','sitelens.manage_projects','sitelens.capture_media','sitelens.delete_media',
      'sitelens.manage_checklists','sitelens.manage_tasks','sitelens.export_reports'
    ]
    ELSE ARRAY['sitelens.view_projects','sitelens.capture_media']
  END;
$$;

-- Resolves the caller's own core_employees row within a given company, or NULL.
CREATE OR REPLACE FUNCTION public.sitelens_current_employee(p_company_id uuid)
RETURNS public.core_employees
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ce.* FROM public.core_employees ce
  WHERE ce.auth_user_id = auth.uid() AND ce.company_id = p_company_id AND ce.auth_user_id IS NOT NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.sitelens_current_employee_id(p_company_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ce.id FROM public.core_employees ce
  WHERE ce.auth_user_id = auth.uid() AND ce.company_id = p_company_id AND ce.auth_user_id IS NOT NULL
  LIMIT 1;
$$;

-- True if the calling authenticated user holds p_permission within p_company_id.
CREATE OR REPLACE FUNCTION public.sitelens_has_permission(p_company_id uuid, p_permission text)
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
        OR p_permission = ANY(public.sitelens_default_permissions(ce.role))
        OR EXISTS (
          SELECT 1 FROM public.sitelens_permission_grants g
          WHERE g.company_id = p_company_id AND g.employee_id = ce.id AND g.permission = p_permission
        )
      )
  );
$$;

-- True if the company has an active entitlement for this module.
CREATE OR REPLACE FUNCTION public.sitelens_module_enabled(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT cm.enabled FROM public.company_modules cm
     WHERE cm.company_id = p_company_id AND cm.module_key = 'sitelens'
     LIMIT 1),
    false
  );
$$;

-- Single round-trip helper the client uses to drive show/hide UI. Every
-- privileged action is still re-checked server-side by RLS/RPCs — this is a
-- UI convenience only, never a security boundary in itself.
CREATE OR REPLACE FUNCTION public.sitelens_my_permissions(p_company_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN ce.role IN ('owner', 'admin', 'administrator') THEN ARRAY[
      'sitelens.view_projects','sitelens.manage_projects','sitelens.capture_media','sitelens.delete_media',
      'sitelens.manage_checklists','sitelens.manage_tasks','sitelens.manage_team','sitelens.manage_settings',
      'sitelens.export_reports'
    ]
    ELSE (
      SELECT array_agg(DISTINCT p) FROM (
        SELECT unnest(public.sitelens_default_permissions(ce.role)) AS p
        UNION
        SELECT g.permission FROM public.sitelens_permission_grants g
        WHERE g.company_id = p_company_id AND g.employee_id = ce.id
      ) perms
    )
  END
  FROM public.core_employees ce
  WHERE ce.auth_user_id = auth.uid() AND ce.company_id = p_company_id AND ce.auth_user_id IS NOT NULL
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- Audit log — module-specific append-only trail (no UPDATE/DELETE policy
-- defined, so ordinary roles can never modify or erase history).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitelens_audit_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  actor_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  action           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        uuid,
  previous_values  jsonb,
  new_values       jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sitelens_audit_logs_company_idx ON public.sitelens_audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sitelens_audit_logs_entity_idx ON public.sitelens_audit_logs(entity_type, entity_id);

ALTER TABLE public.sitelens_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitelens_audit_logs_select ON public.sitelens_audit_logs
  FOR SELECT USING (
    public.sitelens_has_permission(company_id, 'sitelens.export_reports')
    OR company_id IN (
      SELECT ce.company_id FROM public.core_employees ce
      WHERE ce.auth_user_id = auth.uid() AND ce.role IN ('owner', 'admin', 'administrator')
    )
  );

CREATE POLICY sitelens_audit_logs_insert ON public.sitelens_audit_logs
  FOR INSERT WITH CHECK (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Grants — defense-in-depth: revoke PUBLIC/anon EXECUTE, this module has no
-- legitimate unauthenticated flow at all.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.sitelens_default_permissions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sitelens_current_employee(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sitelens_current_employee_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sitelens_has_permission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sitelens_module_enabled(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sitelens_my_permissions(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.sitelens_default_permissions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sitelens_current_employee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sitelens_current_employee_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sitelens_has_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sitelens_module_enabled(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sitelens_my_permissions(uuid) TO authenticated;
