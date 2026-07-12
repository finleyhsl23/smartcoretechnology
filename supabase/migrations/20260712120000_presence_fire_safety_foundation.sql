-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 1: Foundation
-- Shared Core infrastructure (sites, site access) + module permission model
-- + module-specific audit log. Module key: presence-and-fire-safety
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SHARED CORE: sites
-- No shared "sites" concept existed anywhere in SmartCore prior to this
-- migration (every module assumed one implicit site per company). This table
-- is intentionally NOT prefixed with presence_fire_safety_ so future modules
-- (rota, holiday management, etc.) can reference the same site records
-- instead of re-inventing multi-site support.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name               text NOT NULL,
  address_line_1     text,
  address_line_2     text,
  city               text,
  county             text,
  postcode           text,
  country            text DEFAULT 'United Kingdom',
  timezone           text NOT NULL DEFAULT 'Europe/London',
  is_active          boolean NOT NULL DEFAULT true,
  is_default         boolean NOT NULL DEFAULT false,
  assembly_point     text,
  evacuation_notes   text,
  created_by         uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  updated_by         uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- A company may have at most one default site
CREATE UNIQUE INDEX IF NOT EXISTS sites_one_default_per_company
  ON public.sites(company_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS sites_company_id_idx ON public.sites(company_id);

DROP TRIGGER IF EXISTS sites_set_updated_at ON public.sites;
CREATE TRIGGER sites_set_updated_at BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- SHARED CORE: site_access
-- Presence of ANY row for an employee restricts them to the listed site(s).
-- An employee with zero rows here is unrestricted (all of their company's
-- sites) — this keeps single/few-site companies working with zero setup,
-- while allowing larger companies to scope staff to specific sites.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.site_access (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id      uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  UNIQUE(site_id, employee_id)
);
CREATE INDEX IF NOT EXISTS site_access_employee_idx ON public.site_access(employee_id);
CREATE INDEX IF NOT EXISTS site_access_site_idx ON public.site_access(site_id);
CREATE INDEX IF NOT EXISTS site_access_company_idx ON public.site_access(company_id);

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY sites_select_company_members ON public.sites
  FOR SELECT USING (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

CREATE POLICY sites_write_admins ON public.sites
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

CREATE POLICY site_access_select_company_members ON public.site_access
  FOR SELECT USING (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

CREATE POLICY site_access_write_admins ON public.site_access
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
-- MODULE: permission grants
-- Grants ADD permissions on top of the role-based defaults below; owners and
-- admins always have every permission and cannot be reduced below that floor.
-- This gives granular, auditable permissioning (e.g. designating a specific
-- Employee or Manager as a Fire Marshal) without repurposing the shared
-- core_employees.role column, which other modules (CRM, etc.) also depend on.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_permission_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  permission  text NOT NULL,
  granted_by  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, employee_id, permission)
);
CREATE INDEX IF NOT EXISTS pfs_permission_grants_employee_idx
  ON public.presence_fire_safety_permission_grants(employee_id);
CREATE INDEX IF NOT EXISTS pfs_permission_grants_company_idx
  ON public.presence_fire_safety_permission_grants(company_id);

ALTER TABLE public.presence_fire_safety_permission_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY pfs_permission_grants_select_own_company ON public.presence_fire_safety_permission_grants
  FOR SELECT USING (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

CREATE POLICY pfs_permission_grants_write_admins ON public.presence_fire_safety_permission_grants
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

-- Baseline permission set granted by core role, before explicit grants are added.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_default_permissions(p_role text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.sign_others_in_out','presence.manage_visitors','presence.manage_contractors',
      'presence.export_reports','presence.manage_settings','presence.manage_badges',
      'evacuation.unlock','evacuation.start','evacuation.manage_roll_call','evacuation.complete','evacuation.export'
    ]
    WHEN 'admin' THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.sign_others_in_out','presence.manage_visitors','presence.manage_contractors',
      'presence.export_reports','presence.manage_settings','presence.manage_badges',
      'evacuation.unlock','evacuation.start','evacuation.manage_roll_call','evacuation.complete','evacuation.export'
    ]
    WHEN 'administrator' THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.sign_others_in_out','presence.manage_visitors','presence.manage_contractors',
      'presence.export_reports','presence.manage_settings','presence.manage_badges',
      'evacuation.unlock','evacuation.start','evacuation.manage_roll_call','evacuation.complete','evacuation.export'
    ]
    WHEN 'manager' THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.sign_others_in_out','presence.manage_visitors','presence.manage_contractors',
      'presence.export_reports'
    ]
    WHEN 'hr' THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.manage_visitors','presence.export_reports'
    ]
    ELSE ARRAY['presence.view_own_history','presence.sign_self_in_out']
  END;
$$;

-- Resolves the caller's own core_employees row within a given company, or NULL.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_current_employee(p_company_id uuid)
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

-- True if the calling authenticated user holds p_permission within p_company_id.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_has_permission(p_company_id uuid, p_permission text)
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
        OR p_permission = ANY(public.presence_fire_safety_default_permissions(ce.role))
        OR EXISTS (
          SELECT 1 FROM public.presence_fire_safety_permission_grants g
          WHERE g.company_id = p_company_id AND g.employee_id = ce.id AND g.permission = p_permission
        )
      )
  );
$$;

-- True if the calling authenticated user may operate at p_site_id (site must
-- belong to p_company_id; unrestricted by default, see site_access above).
CREATE OR REPLACE FUNCTION public.presence_fire_safety_has_site_access(p_company_id uuid, p_site_id uuid)
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
      AND EXISTS (SELECT 1 FROM public.sites s WHERE s.id = p_site_id AND s.company_id = p_company_id)
      AND (
        NOT EXISTS (SELECT 1 FROM public.site_access sa WHERE sa.employee_id = ce.id)
        OR EXISTS (SELECT 1 FROM public.site_access sa WHERE sa.employee_id = ce.id AND sa.site_id = p_site_id)
      )
  );
$$;

-- True if the company has an active entitlement for this module.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_module_enabled(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT cm.enabled FROM public.company_modules cm
     WHERE cm.company_id = p_company_id AND cm.module_key = 'presence-and-fire-safety'
     LIMIT 1),
    false
  );
$$;

-- ----------------------------------------------------------------------------
-- MODULE: audit log (module-specific — the shared audit_log/audit_logs tables
-- are keyed for other purposes; this keeps evacuation/PIN/administrative
-- actions auditable in one place scoped to this module).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_audit_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id          uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  actor_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  action           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        uuid,
  previous_values  jsonb,
  new_values       jsonb,
  ip_address       text,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pfs_audit_logs_company_idx ON public.presence_fire_safety_audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pfs_audit_logs_entity_idx ON public.presence_fire_safety_audit_logs(entity_type, entity_id);

ALTER TABLE public.presence_fire_safety_audit_logs ENABLE ROW LEVEL SECURITY;

-- Append-only from the client's perspective: no UPDATE/DELETE policy is
-- defined, so ordinary roles can never modify or erase audit history.
CREATE POLICY pfs_audit_logs_select ON public.presence_fire_safety_audit_logs
  FOR SELECT USING (
    public.presence_fire_safety_has_permission(company_id, 'presence.export_reports')
    OR company_id IN (
      SELECT ce.company_id FROM public.core_employees ce
      WHERE ce.auth_user_id = auth.uid() AND ce.role IN ('owner', 'admin', 'administrator')
    )
  );

CREATE POLICY pfs_audit_logs_insert ON public.presence_fire_safety_audit_logs
  FOR INSERT WITH CHECK (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );
