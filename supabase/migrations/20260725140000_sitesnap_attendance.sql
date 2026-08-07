-- ============================================================================
-- SmartCore SiteSnap — Migration: Geofenced clock-in/out attendance, live
-- worker locations, and man-hours reporting.
--
-- Design:
--  - sitesnap_shifts is locked down at the RLS layer (no direct INSERT/UPDATE
--    policy at all) — every mutation goes through a SECURITY DEFINER RPC
--    (sitesnap_clock_in / sitesnap_clock_out / sitesnap_shift_ping) so the
--    radius check always runs server-side against the reported coordinates,
--    never trusting a client-computed "I'm in range" claim.
--  - One active shift per employee at a time, enforced by a partial unique
--    index; clocking into a new project auto-closes any prior active shift.
--  - Owners/admins/administrators are exempt from the geofence entirely (they
--    already have the "administrative" bypass on the client) and can read
--    every shift in the company for the Hours and live Map views.
-- ============================================================================

ALTER TABLE public.sitesnap_settings
  ADD COLUMN IF NOT EXISTS geofence_radius_miles numeric(5,2) NOT NULL DEFAULT 0.5 CHECK (geofence_radius_miles > 0);

-- ----------------------------------------------------------------------------
-- Shifts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitesnap_shifts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.sitesnap_projects(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  clock_in_at       timestamptz NOT NULL DEFAULT now(),
  clock_in_lat      numeric(9,6) NOT NULL,
  clock_in_lng      numeric(9,6) NOT NULL,
  clock_out_at      timestamptz,
  clock_out_lat     numeric(9,6),
  clock_out_lng     numeric(9,6),
  clock_out_reason  text CHECK (clock_out_reason IN ('manual', 'auto_geofence')),
  last_lat          numeric(9,6),
  last_lng          numeric(9,6),
  last_ping_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sitesnap_shifts_company_idx ON public.sitesnap_shifts(company_id, status);
CREATE INDEX IF NOT EXISTS sitesnap_shifts_employee_idx ON public.sitesnap_shifts(employee_id, status);
CREATE INDEX IF NOT EXISTS sitesnap_shifts_project_idx ON public.sitesnap_shifts(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS sitesnap_shifts_one_active_per_employee
  ON public.sitesnap_shifts(employee_id) WHERE status = 'active';

ALTER TABLE public.sitesnap_shifts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.sitesnap_is_admin(p_company_id uuid)
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
REVOKE ALL ON FUNCTION public.sitesnap_is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sitesnap_is_admin(uuid) TO authenticated;

-- Read-only: employees see their own shift history; admins see everyone's
-- (Hours tab, live Map). All writes happen exclusively through the RPCs below.
CREATE POLICY sitesnap_shifts_select ON public.sitesnap_shifts
  FOR SELECT USING (
    employee_id = public.sitesnap_current_employee_id(company_id)
    OR public.sitesnap_is_admin(company_id)
  );

REVOKE ALL ON public.sitesnap_shifts FROM PUBLIC, authenticated, anon;
GRANT SELECT ON public.sitesnap_shifts TO authenticated;

-- ----------------------------------------------------------------------------
-- Distance helper — haversine, returns miles.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sitesnap_distance_miles(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT 3958.8 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  ));
$$;

-- ----------------------------------------------------------------------------
-- sitesnap_current_active_shift — the caller's open shift, or NULL.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sitesnap_current_active_shift(p_company_id uuid)
RETURNS public.sitesnap_shifts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.* FROM public.sitesnap_shifts s
  WHERE s.employee_id = public.sitesnap_current_employee_id(p_company_id)
    AND s.company_id = p_company_id AND s.status = 'active'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.sitesnap_current_active_shift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sitesnap_current_active_shift(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- sitesnap_clock_in — validates the caller is within the company's geofence
-- radius of the project (skipped if the project has no location set),
-- auto-closes any prior active shift, and opens a new one.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sitesnap_clock_in(p_project_id uuid, p_lat numeric, p_lng numeric)
RETURNS public.sitesnap_shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_id uuid;
  v_company_id uuid;
  v_project public.sitesnap_projects;
  v_radius numeric;
  v_distance numeric;
  v_shift public.sitesnap_shifts;
BEGIN
  SELECT ce.id, ce.company_id INTO v_employee_id, v_company_id
  FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid() LIMIT 1;
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found.';
  END IF;
  IF NOT public.sitesnap_module_enabled(v_company_id) THEN
    RAISE EXCEPTION 'SiteSnap is not enabled for your company.';
  END IF;

  SELECT * INTO v_project FROM public.sitesnap_projects
  WHERE id = p_project_id AND company_id = v_company_id AND status = 'active';
  IF v_project.id IS NULL THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;
  IF NOT public.sitesnap_can_access_project(p_project_id) THEN
    RAISE EXCEPTION 'You do not have access to this project.';
  END IF;

  IF v_project.latitude IS NOT NULL AND v_project.longitude IS NOT NULL THEN
    SELECT COALESCE(geofence_radius_miles, 0.5) INTO v_radius
    FROM public.sitesnap_settings WHERE company_id = v_company_id;
    v_radius := COALESCE(v_radius, 0.5);
    v_distance := public.sitesnap_distance_miles(p_lat, p_lng, v_project.latitude, v_project.longitude);
    IF v_distance > v_radius THEN
      RAISE EXCEPTION 'Too far from % — you are %.2f miles away, must be within % miles.',
        v_project.name, v_distance, v_radius;
    END IF;
  END IF;

  UPDATE public.sitesnap_shifts SET status = 'closed', clock_out_at = now(),
    clock_out_lat = p_lat, clock_out_lng = p_lng, clock_out_reason = 'manual'
  WHERE employee_id = v_employee_id AND status = 'active';

  INSERT INTO public.sitesnap_shifts (company_id, employee_id, project_id, clock_in_lat, clock_in_lng, last_lat, last_lng, last_ping_at)
  VALUES (v_company_id, v_employee_id, p_project_id, p_lat, p_lng, p_lat, p_lng, now())
  RETURNING * INTO v_shift;

  RETURN v_shift;
END;
$$;
REVOKE ALL ON FUNCTION public.sitesnap_clock_in(uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sitesnap_clock_in(uuid, numeric, numeric) TO authenticated;

-- ----------------------------------------------------------------------------
-- sitesnap_clock_out — manual sign-out; still requires being in radius.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sitesnap_clock_out(p_shift_id uuid, p_lat numeric, p_lng numeric)
RETURNS public.sitesnap_shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_id uuid;
  v_shift public.sitesnap_shifts;
  v_project public.sitesnap_projects;
  v_radius numeric;
  v_distance numeric;
BEGIN
  SELECT ce.id INTO v_employee_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid() LIMIT 1;

  SELECT * INTO v_shift FROM public.sitesnap_shifts
  WHERE id = p_shift_id AND employee_id = v_employee_id AND status = 'active';
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Active shift not found.';
  END IF;

  SELECT * INTO v_project FROM public.sitesnap_projects WHERE id = v_shift.project_id;
  IF v_project.latitude IS NOT NULL AND v_project.longitude IS NOT NULL THEN
    SELECT COALESCE(geofence_radius_miles, 0.5) INTO v_radius
    FROM public.sitesnap_settings WHERE company_id = v_shift.company_id;
    v_radius := COALESCE(v_radius, 0.5);
    v_distance := public.sitesnap_distance_miles(p_lat, p_lng, v_project.latitude, v_project.longitude);
    IF v_distance > v_radius THEN
      RAISE EXCEPTION 'Too far from % — you are %.2f miles away, must be within % miles to sign out.',
        v_project.name, v_distance, v_radius;
    END IF;
  END IF;

  UPDATE public.sitesnap_shifts SET status = 'closed', clock_out_at = now(),
    clock_out_lat = p_lat, clock_out_lng = p_lng, clock_out_reason = 'manual',
    last_lat = p_lat, last_lng = p_lng, last_ping_at = now()
  WHERE id = p_shift_id
  RETURNING * INTO v_shift;

  RETURN v_shift;
END;
$$;
REVOKE ALL ON FUNCTION public.sitesnap_clock_out(uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sitesnap_clock_out(uuid, numeric, numeric) TO authenticated;

-- ----------------------------------------------------------------------------
-- sitesnap_shift_ping — periodic foreground location update while clocked
-- in. Auto-closes the shift (clock_out_reason = 'auto_geofence') the moment
-- a ping lands outside the radius, so leaving the site signs you out without
-- any further client action.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sitesnap_shift_ping(p_shift_id uuid, p_lat numeric, p_lng numeric)
RETURNS public.sitesnap_shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_id uuid;
  v_shift public.sitesnap_shifts;
  v_project public.sitesnap_projects;
  v_radius numeric;
  v_distance numeric;
  v_outside boolean := false;
BEGIN
  SELECT ce.id INTO v_employee_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid() LIMIT 1;

  SELECT * INTO v_shift FROM public.sitesnap_shifts
  WHERE id = p_shift_id AND employee_id = v_employee_id AND status = 'active';
  IF v_shift.id IS NULL THEN
    RAISE EXCEPTION 'Active shift not found.';
  END IF;

  SELECT * INTO v_project FROM public.sitesnap_projects WHERE id = v_shift.project_id;
  IF v_project.latitude IS NOT NULL AND v_project.longitude IS NOT NULL THEN
    SELECT COALESCE(geofence_radius_miles, 0.5) INTO v_radius
    FROM public.sitesnap_settings WHERE company_id = v_shift.company_id;
    v_radius := COALESCE(v_radius, 0.5);
    v_distance := public.sitesnap_distance_miles(p_lat, p_lng, v_project.latitude, v_project.longitude);
    v_outside := v_distance > v_radius;
  END IF;

  IF v_outside THEN
    UPDATE public.sitesnap_shifts SET status = 'closed', clock_out_at = now(),
      clock_out_lat = p_lat, clock_out_lng = p_lng, clock_out_reason = 'auto_geofence',
      last_lat = p_lat, last_lng = p_lng, last_ping_at = now()
    WHERE id = p_shift_id
    RETURNING * INTO v_shift;
  ELSE
    UPDATE public.sitesnap_shifts SET last_lat = p_lat, last_lng = p_lng, last_ping_at = now()
    WHERE id = p_shift_id
    RETURNING * INTO v_shift;
  END IF;

  RETURN v_shift;
END;
$$;
REVOKE ALL ON FUNCTION public.sitesnap_shift_ping(uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sitesnap_shift_ping(uuid, numeric, numeric) TO authenticated;
