-- ============================================================================
-- SmartCore Flexi — Migration 1: Foundation
-- Personal training / gym coaching module. Identity is public.core_employees
-- / public.smartcore_core_companies, the same identity source CRM, SiteSnap
-- and Presence & Fire Safety use. Module key: flexi. Tables are prefixed
-- smartcore_flexi_ in the public schema (the tenant already owns the
-- smartcore_core_companies / smartcore_core_purchased_modules naming, so the
-- module's own tables carry the same smartcore_ root rather than the bare
-- <module>_ prefix SiteSnap and Presence & Fire Safety used).
--
-- Two distinct identities exist in this module:
--   - Trainers/staff: public.core_employees rows (role owner/admin/
--     administrator/manager/employee), exactly like every other module.
--   - Clients: smartcore_flexi_clients rows with their own auth_user_id,
--     authenticated the same way (Supabase Auth) but never core_employees —
--     they are the gym/PT business's customers, not SmartCore platform staff.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Permission grants — additive on top of role-based defaults below; owners,
-- admins and administrators always have every permission and cannot be
-- reduced below that floor. Mirrors sitesnap_permission_grants.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_permission_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  permission  text NOT NULL,
  granted_by  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, employee_id, permission)
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_permission_grants_employee_idx ON public.smartcore_flexi_permission_grants(employee_id);
CREATE INDEX IF NOT EXISTS smartcore_flexi_permission_grants_company_idx ON public.smartcore_flexi_permission_grants(company_id);

ALTER TABLE public.smartcore_flexi_permission_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_permission_grants_select_own_company ON public.smartcore_flexi_permission_grants
  FOR SELECT USING (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

CREATE POLICY smartcore_flexi_permission_grants_write_admins ON public.smartcore_flexi_permission_grants
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

CREATE OR REPLACE FUNCTION public.flexi_default_permissions(p_role text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY[
      'flexi.view_clients','flexi.manage_clients','flexi.manage_programs','flexi.manage_exercises',
      'flexi.manage_bookings','flexi.manage_classes','flexi.send_messages','flexi.manage_nutrition',
      'flexi.manage_checkins','flexi.manage_packages','flexi.manage_waivers','flexi.manage_community',
      'flexi.manage_locations','flexi.manage_team','flexi.manage_settings','flexi.export_reports',
      'flexi.view_audit_log'
    ]
    WHEN 'admin' THEN ARRAY[
      'flexi.view_clients','flexi.manage_clients','flexi.manage_programs','flexi.manage_exercises',
      'flexi.manage_bookings','flexi.manage_classes','flexi.send_messages','flexi.manage_nutrition',
      'flexi.manage_checkins','flexi.manage_packages','flexi.manage_waivers','flexi.manage_community',
      'flexi.manage_locations','flexi.manage_team','flexi.manage_settings','flexi.export_reports',
      'flexi.view_audit_log'
    ]
    WHEN 'administrator' THEN ARRAY[
      'flexi.view_clients','flexi.manage_clients','flexi.manage_programs','flexi.manage_exercises',
      'flexi.manage_bookings','flexi.manage_classes','flexi.send_messages','flexi.manage_nutrition',
      'flexi.manage_checkins','flexi.manage_packages','flexi.manage_waivers','flexi.manage_community',
      'flexi.manage_locations','flexi.manage_team','flexi.manage_settings','flexi.export_reports',
      'flexi.view_audit_log'
    ]
    WHEN 'manager' THEN ARRAY[
      'flexi.view_clients','flexi.manage_clients','flexi.manage_programs','flexi.manage_exercises',
      'flexi.manage_bookings','flexi.manage_classes','flexi.send_messages','flexi.manage_nutrition',
      'flexi.manage_checkins','flexi.manage_packages','flexi.manage_waivers','flexi.manage_community',
      'flexi.export_reports'
    ]
    ELSE ARRAY[
      'flexi.view_clients','flexi.manage_clients','flexi.manage_programs','flexi.manage_exercises',
      'flexi.manage_bookings','flexi.send_messages','flexi.manage_nutrition','flexi.manage_checkins',
      'flexi.manage_waivers'
    ]
  END;
$$;

CREATE OR REPLACE FUNCTION public.flexi_current_employee(p_company_id uuid)
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

CREATE OR REPLACE FUNCTION public.flexi_current_employee_id(p_company_id uuid)
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

CREATE OR REPLACE FUNCTION public.flexi_has_permission(p_company_id uuid, p_permission text)
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
        OR p_permission = ANY(public.flexi_default_permissions(ce.role))
        OR EXISTS (
          SELECT 1 FROM public.smartcore_flexi_permission_grants g
          WHERE g.company_id = p_company_id AND g.employee_id = ce.id AND g.permission = p_permission
        )
      )
  );
$$;

-- True if the calling employee is an owner/admin/administrator of the company
-- (sees every client regardless of trainer assignment, bypasses the
-- trainer_id ownership check used across client-scoped tables below).
CREATE OR REPLACE FUNCTION public.flexi_is_admin(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.core_employees ce
    WHERE ce.auth_user_id = auth.uid() AND ce.company_id = p_company_id
      AND ce.role IN ('owner', 'admin', 'administrator')
  );
$$;

CREATE OR REPLACE FUNCTION public.flexi_module_enabled(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT cm.enabled FROM public.company_modules cm
     WHERE cm.company_id = p_company_id AND cm.module_key = 'flexi'
     LIMIT 1),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.flexi_my_permissions(p_company_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN ce.role IN ('owner', 'admin', 'administrator') THEN ARRAY[
      'flexi.view_clients','flexi.manage_clients','flexi.manage_programs','flexi.manage_exercises',
      'flexi.manage_bookings','flexi.manage_classes','flexi.send_messages','flexi.manage_nutrition',
      'flexi.manage_checkins','flexi.manage_packages','flexi.manage_waivers','flexi.manage_community',
      'flexi.manage_locations','flexi.manage_team','flexi.manage_settings','flexi.export_reports',
      'flexi.view_audit_log'
    ]
    ELSE (
      SELECT array_agg(DISTINCT p) FROM (
        SELECT unnest(public.flexi_default_permissions(ce.role)) AS p
        UNION
        SELECT g.permission FROM public.smartcore_flexi_permission_grants g
        WHERE g.company_id = p_company_id AND g.employee_id = ce.id
      ) perms
    )
  END
  FROM public.core_employees ce
  WHERE ce.auth_user_id = auth.uid() AND ce.company_id = p_company_id AND ce.auth_user_id IS NOT NULL
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- Locations — Enterprise-tier multi-site support; every Starter/Growth/Studio
-- business still gets exactly one implicit location row.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_locations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  address_line_1 text,
  address_line_2 text,
  city         text,
  postcode     text,
  country      text DEFAULT 'United Kingdom',
  is_primary   boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS smartcore_flexi_locations_one_primary ON public.smartcore_flexi_locations(company_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS smartcore_flexi_locations_company_idx ON public.smartcore_flexi_locations(company_id);

ALTER TABLE public.smartcore_flexi_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_locations_select ON public.smartcore_flexi_locations
  FOR SELECT USING (public.flexi_has_permission(company_id, 'flexi.view_clients'));

CREATE POLICY smartcore_flexi_locations_write ON public.smartcore_flexi_locations
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_locations'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_locations'));

-- ----------------------------------------------------------------------------
-- Business settings — one row per tenant. billing_currency defaults to GBP;
-- the whole pricing model this module ships with (see systems/flexi/shared)
-- is quoted in GBP by design, unlike the USD-only competitors researched.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_settings (
  company_id       uuid PRIMARY KEY REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  business_name    text,
  brand_color      text DEFAULT '#ff5a36',
  logo_url         text,
  billing_currency text NOT NULL DEFAULT 'GBP',
  timezone         text NOT NULL DEFAULT 'Europe/London',
  contract_billing_mode text NOT NULL DEFAULT 'flex' CHECK (contract_billing_mode IN ('flex', 'committed_12mo', 'annual_prepay')),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.smartcore_flexi_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_settings_select ON public.smartcore_flexi_settings
  FOR SELECT USING (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

CREATE POLICY smartcore_flexi_settings_write ON public.smartcore_flexi_settings
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_settings'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_settings'));

-- ----------------------------------------------------------------------------
-- Clients — the PT business's own customers. Not core_employees: they get a
-- lightweight portal identity of their own (auth_user_id, nullable until
-- they accept their invite and set a password).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  trainer_id      uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  location_id     uuid REFERENCES public.smartcore_flexi_locations(id) ON DELETE SET NULL,
  auth_user_id    uuid UNIQUE,
  full_name       text NOT NULL,
  email           text,
  phone           text,
  date_of_birth   date,
  sex             text,
  goals           text,
  medical_notes   text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  starting_weight_kg numeric(6,2),
  height_cm       numeric(6,2),
  units           text NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial')),
  created_by      uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_clients_company_idx ON public.smartcore_flexi_clients(company_id);
CREATE INDEX IF NOT EXISTS smartcore_flexi_clients_trainer_idx ON public.smartcore_flexi_clients(trainer_id);

ALTER TABLE public.smartcore_flexi_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_clients_select_staff ON public.smartcore_flexi_clients
  FOR SELECT USING (
    public.flexi_has_permission(company_id, 'flexi.view_clients')
    AND (public.flexi_is_admin(company_id) OR trainer_id IS NULL OR trainer_id = public.flexi_current_employee_id(company_id))
  );

CREATE POLICY smartcore_flexi_clients_write_staff ON public.smartcore_flexi_clients
  FOR ALL USING (
    public.flexi_has_permission(company_id, 'flexi.manage_clients')
    AND (public.flexi_is_admin(company_id) OR trainer_id IS NULL OR trainer_id = public.flexi_current_employee_id(company_id))
  ) WITH CHECK (
    public.flexi_has_permission(company_id, 'flexi.manage_clients')
  );

CREATE POLICY smartcore_flexi_clients_select_self ON public.smartcore_flexi_clients
  FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY smartcore_flexi_clients_update_self ON public.smartcore_flexi_clients
  FOR UPDATE USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Resolves a client's own smartcore_flexi_clients row from their auth uid.
-- SECURITY DEFINER because the client portal has no core_employees identity
-- to piggyback on — this is the client-side equivalent of flexi_current_employee.
-- Defined here (not with the other helpers above) because it returns the
-- smartcore_flexi_clients row type, which must exist first.
CREATE OR REPLACE FUNCTION public.flexi_current_client()
RETURNS public.smartcore_flexi_clients
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.* FROM public.smartcore_flexi_clients c
  WHERE c.auth_user_id = auth.uid() AND c.auth_user_id IS NOT NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.flexi_current_client_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.id FROM public.smartcore_flexi_clients c
  WHERE c.auth_user_id = auth.uid() AND c.auth_user_id IS NOT NULL
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- Client invites — trainer generates a token, client visits
-- client-invite.html?token=..., sets a password, we link auth_user_id.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_client_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  client_id   uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  token       text UNIQUE NOT NULL,
  email       text NOT NULL,
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  used_at     timestamptz,
  created_by  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_client_invites_client_idx ON public.smartcore_flexi_client_invites(client_id);

ALTER TABLE public.smartcore_flexi_client_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_client_invites_staff ON public.smartcore_flexi_client_invites
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_clients'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_clients'));

-- The invite lookup itself (by token, before the client has an auth session
-- tied to company data) happens through the public anon-safe RPC below.
CREATE OR REPLACE FUNCTION public.flexi_get_invite(p_token text)
RETURNS TABLE (
  client_id uuid, company_id uuid, email text, full_name text, business_name text, expired boolean, used boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT i.client_id, i.company_id, i.email, c.full_name,
         COALESCE(s.business_name, comp.company_name), (i.expires_at < now()), (i.used_at IS NOT NULL)
  FROM public.smartcore_flexi_client_invites i
  JOIN public.smartcore_flexi_clients c ON c.id = i.client_id
  LEFT JOIN public.smartcore_flexi_settings s ON s.company_id = i.company_id
  LEFT JOIN public.smartcore_core_companies comp ON comp.id = i.company_id
  WHERE i.token = p_token
  LIMIT 1;
$$;

-- Called once by the client-invite page right after supabase.auth.signUp()
-- succeeds — links the freshly created auth user to their client row and
-- marks the invite used. SECURITY DEFINER because the client has no RLS
-- write access to their own auth_user_id column until this runs.
CREATE OR REPLACE FUNCTION public.flexi_accept_invite(p_token text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client_id uuid;
  v_used_at timestamptz;
  v_expires_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT client_id, used_at, expires_at INTO v_client_id, v_used_at, v_expires_at
  FROM public.smartcore_flexi_client_invites WHERE token = p_token;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;
  IF v_used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite already used';
  END IF;
  IF v_expires_at < now() THEN
    RAISE EXCEPTION 'Invite expired';
  END IF;

  UPDATE public.smartcore_flexi_clients SET auth_user_id = auth.uid(), updated_at = now() WHERE id = v_client_id;
  UPDATE public.smartcore_flexi_client_invites SET used_at = now() WHERE token = p_token;

  RETURN v_client_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.flexi_default_permissions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flexi_current_employee(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flexi_current_employee_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flexi_has_permission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flexi_is_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flexi_module_enabled(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flexi_my_permissions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flexi_current_client() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flexi_current_client_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flexi_accept_invite(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.flexi_default_permissions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flexi_current_employee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flexi_current_employee_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flexi_has_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flexi_is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flexi_module_enabled(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flexi_my_permissions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.flexi_current_client() TO authenticated;
GRANT EXECUTE ON FUNCTION public.flexi_current_client_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.flexi_accept_invite(text) TO authenticated;

-- flexi_get_invite is the one legitimate unauthenticated flow — a prospective
-- client has no session yet when they land on client-invite.html.
GRANT EXECUTE ON FUNCTION public.flexi_get_invite(text) TO anon, authenticated;
