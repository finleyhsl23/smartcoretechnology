-- ============================================================================
-- SmartCore SiteSnap — Client phone/email on projects, and fix the geofence
-- distance messages.
--
-- The '%.2f' in the earlier RAISE EXCEPTION strings doesn't do anything in
-- PL/pgSQL — RAISE only supports plain '%' as a positional placeholder, it
-- has no printf-style width/precision support. The literal characters
-- ".2f" were being appended after the full-precision float, e.g. "you are
-- 2.73847392626293.2f miles away". Fixed by rounding to 1 decimal place
-- with ROUND() before it ever reaches the message.
-- ============================================================================

ALTER TABLE public.sitesnap_projects
  ADD COLUMN IF NOT EXISTS client_phone text,
  ADD COLUMN IF NOT EXISTS client_email text;

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
    v_distance := ROUND(public.sitesnap_distance_miles(p_lat, p_lng, v_project.latitude, v_project.longitude), 1);
    IF v_distance > v_radius THEN
      RAISE EXCEPTION 'Too far from % — you are % miles away, must be within % miles.',
        v_project.name, v_distance, ROUND(v_radius, 1);
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
    v_distance := ROUND(public.sitesnap_distance_miles(p_lat, p_lng, v_project.latitude, v_project.longitude), 1);
    IF v_distance > v_radius THEN
      RAISE EXCEPTION 'Too far from % — you are % miles away, must be within % miles to sign out.',
        v_project.name, v_distance, ROUND(v_radius, 1);
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
