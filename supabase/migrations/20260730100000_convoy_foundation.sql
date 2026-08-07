-- ============================================================================
-- SmartCore Convoy — Migration 1: Foundation
-- Vehicle check & defect management, with GPS-verified driver walkarounds.
-- Identity is public.core_employees / public.smartcore_core_companies — the
-- same identity source every other cross-tenant marketplace module uses
-- (Presence & Fire Safety, SiteSnap, SiteStamp). Module key: convoy. Tables
-- are prefixed convoy_ in the public schema.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Permission grants — additive on top of role-based defaults below; owners,
-- admins and administrators always have every permission and cannot be
-- reduced below that floor. Mirrors sitesnap_permission_grants.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.convoy_permission_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  permission  text NOT NULL,
  granted_by  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, employee_id, permission)
);
CREATE INDEX IF NOT EXISTS convoy_permission_grants_employee_idx ON public.convoy_permission_grants(employee_id);
CREATE INDEX IF NOT EXISTS convoy_permission_grants_company_idx ON public.convoy_permission_grants(company_id);

ALTER TABLE public.convoy_permission_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY convoy_permission_grants_select_own_company ON public.convoy_permission_grants
  FOR SELECT USING (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

CREATE POLICY convoy_permission_grants_write_admins ON public.convoy_permission_grants
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
CREATE OR REPLACE FUNCTION public.convoy_default_permissions(p_role text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY[
      'convoy.view_vehicles','convoy.manage_vehicles','convoy.perform_checks','convoy.manage_defects',
      'convoy.manage_checklists','convoy.manage_drivers','convoy.manage_team','convoy.manage_settings',
      'convoy.export_reports'
    ]
    WHEN 'admin' THEN ARRAY[
      'convoy.view_vehicles','convoy.manage_vehicles','convoy.perform_checks','convoy.manage_defects',
      'convoy.manage_checklists','convoy.manage_drivers','convoy.manage_team','convoy.manage_settings',
      'convoy.export_reports'
    ]
    WHEN 'administrator' THEN ARRAY[
      'convoy.view_vehicles','convoy.manage_vehicles','convoy.perform_checks','convoy.manage_defects',
      'convoy.manage_checklists','convoy.manage_drivers','convoy.manage_team','convoy.manage_settings',
      'convoy.export_reports'
    ]
    WHEN 'manager' THEN ARRAY[
      'convoy.view_vehicles','convoy.manage_vehicles','convoy.perform_checks','convoy.manage_defects',
      'convoy.manage_checklists','convoy.manage_drivers','convoy.export_reports'
    ]
    ELSE ARRAY['convoy.view_vehicles','convoy.perform_checks']
  END;
$$;

-- Resolves the caller's own core_employees row within a given company, or NULL.
CREATE OR REPLACE FUNCTION public.convoy_current_employee(p_company_id uuid)
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

CREATE OR REPLACE FUNCTION public.convoy_current_employee_id(p_company_id uuid)
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
CREATE OR REPLACE FUNCTION public.convoy_has_permission(p_company_id uuid, p_permission text)
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
        OR p_permission = ANY(public.convoy_default_permissions(ce.role))
        OR EXISTS (
          SELECT 1 FROM public.convoy_permission_grants g
          WHERE g.company_id = p_company_id AND g.employee_id = ce.id AND g.permission = p_permission
        )
      )
  );
$$;

-- True if the company has an active entitlement for this module.
CREATE OR REPLACE FUNCTION public.convoy_module_enabled(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT cm.enabled FROM public.company_modules cm
     WHERE cm.company_id = p_company_id AND cm.module_key = 'convoy'
     LIMIT 1),
    false
  );
$$;

-- Single round-trip helper the client uses to drive show/hide UI. Every
-- privileged action is still re-checked server-side by RLS/RPCs — this is a
-- UI convenience only, never a security boundary in itself.
CREATE OR REPLACE FUNCTION public.convoy_my_permissions(p_company_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN ce.role IN ('owner', 'admin', 'administrator') THEN ARRAY[
      'convoy.view_vehicles','convoy.manage_vehicles','convoy.perform_checks','convoy.manage_defects',
      'convoy.manage_checklists','convoy.manage_drivers','convoy.manage_team','convoy.manage_settings',
      'convoy.export_reports'
    ]
    ELSE (
      SELECT array_agg(DISTINCT p) FROM (
        SELECT unnest(public.convoy_default_permissions(ce.role)) AS p
        UNION
        SELECT g.permission FROM public.convoy_permission_grants g
        WHERE g.company_id = p_company_id AND g.employee_id = ce.id
      ) perms
    )
  END
  FROM public.core_employees ce
  WHERE ce.auth_user_id = auth.uid() AND ce.company_id = p_company_id AND ce.auth_user_id IS NOT NULL
  LIMIT 1;
$$;

-- Great-circle distance in metres between two lat/lng points — used to check
-- how far a driver's GPS fix was from a vehicle's registered depot location,
-- and to cross-check consistency between a walkaround's own zone photos.
CREATE OR REPLACE FUNCTION public.convoy_distance_metres(
  p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT CASE
    WHEN p_lat1 IS NULL OR p_lng1 IS NULL OR p_lat2 IS NULL OR p_lng2 IS NULL THEN NULL
    ELSE (
      2 * 6371000 * asin(sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
        cos(radians(p_lat1)) * cos(radians(p_lat2)) *
        power(sin(radians(p_lng2 - p_lng1) / 2), 2)
      ))
    )
  END;
$$;

-- ----------------------------------------------------------------------------
-- Company settings — geofence tolerance, minimum walkaround time, reminder
-- lead times. One row per company, created lazily on first read.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.convoy_settings (
  company_id                uuid PRIMARY KEY REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  default_geofence_radius_m integer NOT NULL DEFAULT 150,
  min_walkaround_seconds    integer NOT NULL DEFAULT 45,
  gps_accuracy_warn_m       integer NOT NULL DEFAULT 100,
  compliance_reminder_days  integer NOT NULL DEFAULT 14,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.convoy_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY convoy_settings_select ON public.convoy_settings
  FOR SELECT USING (public.convoy_has_permission(company_id, 'convoy.view_vehicles'));

CREATE POLICY convoy_settings_write ON public.convoy_settings
  FOR ALL USING (public.convoy_has_permission(company_id, 'convoy.manage_settings'))
  WITH CHECK (public.convoy_has_permission(company_id, 'convoy.manage_settings'));

-- Bootstraps a company's settings row with hard-coded defaults the first
-- time it's read (e.g. by a driver opening the check page before any admin
-- has visited Settings). Deliberately does not accept caller-supplied
-- values — a plain driver can trigger row creation but can never choose the
-- geofence radius or minimum walkaround time that check against them,
-- which would defeat the point of those thresholds. Changing existing
-- values still requires convoy.manage_settings via convoy_settings_write.
CREATE OR REPLACE FUNCTION public.convoy_ensure_settings(p_company_id uuid)
RETURNS public.convoy_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings public.convoy_settings;
BEGIN
  IF NOT public.convoy_has_permission(p_company_id, 'convoy.view_vehicles') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  SELECT * INTO v_settings FROM public.convoy_settings WHERE company_id = p_company_id;
  IF v_settings IS NULL THEN
    INSERT INTO public.convoy_settings (company_id) VALUES (p_company_id)
    ON CONFLICT (company_id) DO NOTHING
    RETURNING * INTO v_settings;
    IF v_settings IS NULL THEN
      SELECT * INTO v_settings FROM public.convoy_settings WHERE company_id = p_company_id;
    END IF;
  END IF;
  RETURN v_settings;
END;
$$;

-- ----------------------------------------------------------------------------
-- Audit log — module-specific append-only trail (no UPDATE/DELETE policy
-- defined, so ordinary roles can never modify or erase history).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.convoy_audit_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  actor_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  action            text NOT NULL,
  entity_type       text NOT NULL,
  entity_id         uuid,
  previous_values   jsonb,
  new_values        jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS convoy_audit_logs_company_idx ON public.convoy_audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS convoy_audit_logs_entity_idx ON public.convoy_audit_logs(entity_type, entity_id);

ALTER TABLE public.convoy_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY convoy_audit_logs_select ON public.convoy_audit_logs
  FOR SELECT USING (
    public.convoy_has_permission(company_id, 'convoy.export_reports')
    OR company_id IN (
      SELECT ce.company_id FROM public.core_employees ce
      WHERE ce.auth_user_id = auth.uid() AND ce.role IN ('owner', 'admin', 'administrator')
    )
  );

CREATE POLICY convoy_audit_logs_insert ON public.convoy_audit_logs
  FOR INSERT WITH CHECK (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Grants — defense-in-depth: revoke PUBLIC/anon EXECUTE, this module has no
-- legitimate unauthenticated flow at all.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.convoy_default_permissions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convoy_current_employee(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convoy_current_employee_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convoy_has_permission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convoy_module_enabled(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convoy_my_permissions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convoy_distance_metres(numeric, numeric, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convoy_ensure_settings(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.convoy_default_permissions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convoy_current_employee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convoy_current_employee_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convoy_has_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convoy_module_enabled(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convoy_my_permissions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convoy_distance_metres(numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convoy_ensure_settings(uuid) TO authenticated;
