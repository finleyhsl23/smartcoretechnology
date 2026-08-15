-- Every Module Settings field becomes overridable per site. A site with no
-- override row inherits the company-wide row entirely; saving settings for
-- a specific site writes a full override row for that site; "Reset to
-- company default" just deletes it. presence_fire_safety_settings stays as
-- the company-wide row/default; presence_fire_safety_site_settings grows to
-- mirror every overridable field (all nullable — null means "inherit").

ALTER TABLE public.presence_fire_safety_site_settings
  ADD COLUMN IF NOT EXISTS allow_manual_employee_lookup boolean,
  ADD COLUMN IF NOT EXISTS allow_employee_code_lookup boolean,
  ADD COLUMN IF NOT EXISTS visitor_photo_enabled boolean,
  ADD COLUMN IF NOT EXISTS contractor_management_enabled boolean,
  ADD COLUMN IF NOT EXISTS evacuation_pin_hash text,
  ADD COLUMN IF NOT EXISTS failed_pin_limit integer,
  ADD COLUMN IF NOT EXISTS failed_pin_lockout_minutes integer,
  ADD COLUMN IF NOT EXISTS data_retention_days integer,
  ADD COLUMN IF NOT EXISTS kiosk_exit_pin_hash text,
  ADD COLUMN IF NOT EXISTS sound_effects_enabled boolean,
  ADD COLUMN IF NOT EXISTS kiosk_screensaver_enabled boolean,
  ADD COLUMN IF NOT EXISTS emergency_report_emails jsonb,
  ADD COLUMN IF NOT EXISTS custom_keyboard_enabled boolean,
  ADD COLUMN IF NOT EXISTS leaving_check_query_emails jsonb;

ALTER TABLE public.presence_fire_safety_kiosk_pin_attempts
  ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;

-- Merges a site's overrides onto the company row. Plain SQL, no
-- SECURITY DEFINER — runs as the caller, so it only ever sees what the
-- caller could already see by querying both tables directly (both have the
-- same "any employee of this company" SELECT policy). Column list and
-- order must match presence_fire_safety_settings exactly.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_effective_settings(p_company_id uuid, p_site_id uuid)
RETURNS SETOF public.presence_fire_safety_settings
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.company_id,
    COALESCE(ov.default_sign_in_method, s.default_sign_in_method),
    COALESCE(ov.allow_manual_employee_lookup, s.allow_manual_employee_lookup),
    COALESCE(ov.allow_employee_code_lookup, s.allow_employee_code_lookup),
    COALESCE(ov.visitor_photo_enabled, s.visitor_photo_enabled),
    COALESCE(ov.contractor_management_enabled, s.contractor_management_enabled),
    COALESCE(ov.auto_sign_out_enabled, s.auto_sign_out_enabled),
    COALESCE(ov.auto_sign_out_time, s.auto_sign_out_time),
    COALESCE(ov.evacuation_pin_hash, s.evacuation_pin_hash),
    COALESCE(ov.evacuation_unlock_duration_minutes, s.evacuation_unlock_duration_minutes),
    COALESCE(ov.failed_pin_limit, s.failed_pin_limit),
    COALESCE(ov.failed_pin_lockout_minutes, s.failed_pin_lockout_minutes),
    COALESCE(ov.data_retention_days, s.data_retention_days),
    s.updated_by, s.created_at, s.updated_at,
    COALESCE(ov.kiosk_exit_pin_hash, s.kiosk_exit_pin_hash),
    COALESCE(ov.sound_effects_enabled, s.sound_effects_enabled),
    s.id_card_template, s.id_card_logo_url,
    COALESCE(ov.kiosk_screensaver_enabled, s.kiosk_screensaver_enabled),
    COALESCE(ov.emergency_report_emails, s.emergency_report_emails),
    COALESCE(ov.custom_keyboard_enabled, s.custom_keyboard_enabled),
    COALESCE(ov.leaving_check_query_emails, s.leaving_check_query_emails)
  FROM public.presence_fire_safety_settings s
  LEFT JOIN public.presence_fire_safety_site_settings ov
    ON ov.company_id = s.company_id AND ov.site_id = p_site_id
  WHERE s.company_id = p_company_id;
$$;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_effective_settings(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_effective_settings(uuid, uuid) TO authenticated;

-- Evacuation PIN: p_site_id now optional — omitted/NULL sets the company
-- default (unchanged behaviour), given sets that one site's override.
DROP FUNCTION IF EXISTS public.presence_fire_safety_set_evacuation_pin(uuid, text);
CREATE FUNCTION public.presence_fire_safety_set_evacuation_pin(p_company_id uuid, p_pin text, p_site_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_caller public.core_employees;
BEGIN
  IF NOT public.presence_fire_safety_has_permission(p_company_id, 'presence.manage_settings') THEN
    RAISE EXCEPTION 'Missing permission: presence.manage_settings' USING ERRCODE = '42501';
  END IF;
  v_caller := public.presence_fire_safety_current_employee(p_company_id);

  IF p_pin IS NULL OR length(p_pin) < 4 OR length(p_pin) > 12 OR p_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN must be 4-12 digits' USING ERRCODE = '22023';
  END IF;

  IF p_site_id IS NULL THEN
    INSERT INTO public.presence_fire_safety_settings (company_id, evacuation_pin_hash, updated_by)
    VALUES (p_company_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), v_caller.id)
    ON CONFLICT (company_id) DO UPDATE SET
      evacuation_pin_hash = EXCLUDED.evacuation_pin_hash, updated_by = v_caller.id, updated_at = now();
  ELSE
    INSERT INTO public.presence_fire_safety_site_settings (company_id, site_id, evacuation_pin_hash, updated_by)
    VALUES (p_company_id, p_site_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), v_caller.id)
    ON CONFLICT (company_id, site_id) DO UPDATE SET
      evacuation_pin_hash = EXCLUDED.evacuation_pin_hash, updated_by = v_caller.id, updated_at = now();
  END IF;

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, site_id, actor_employee_id, action, entity_type, entity_id)
  VALUES (p_company_id, p_site_id, v_caller.id, 'evacuation_pin_set', 'settings', NULL);

  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_set_evacuation_pin(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_set_evacuation_pin(uuid, text, uuid) TO authenticated;

-- Evacuation PIN verify: now resolves the effective (site-override-aware)
-- settings row instead of reading the company row directly — everything
-- else (lockout counting, unlock token) is unchanged.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_verify_evacuation_pin(p_company_id uuid, p_site_id uuid, p_pin text)
RETURNS TABLE(unlock_token text, expires_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_caller public.core_employees;
  v_settings public.presence_fire_safety_settings;
  v_recent_failures integer;
  v_lockout_window interval;
  v_stored_hash text;
  v_ok boolean;
  v_raw_token text;
  v_expires timestamptz;
BEGIN
  IF NOT public.presence_fire_safety_has_permission(p_company_id, 'evacuation.unlock') THEN
    RAISE EXCEPTION 'Missing permission: evacuation.unlock' USING ERRCODE = '42501';
  END IF;
  IF NOT public.presence_fire_safety_has_site_access(p_company_id, p_site_id) THEN
    RAISE EXCEPTION 'No access to this site' USING ERRCODE = '42501';
  END IF;

  v_caller := public.presence_fire_safety_current_employee(p_company_id);
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings FROM public.presence_fire_safety_effective_settings(p_company_id, p_site_id);
  IF v_settings.evacuation_pin_hash IS NULL THEN
    RAISE EXCEPTION 'No evacuation PIN has been configured for this site' USING ERRCODE = '42501';
  END IF;

  v_lockout_window := make_interval(mins => v_settings.failed_pin_lockout_minutes);

  SELECT count(*) INTO v_recent_failures
  FROM public.presence_fire_safety_evacuation_pin_attempts
  WHERE company_id = p_company_id
    AND attempted_by_employee_id = v_caller.id
    AND success = false
    AND created_at > now() - v_lockout_window;

  IF v_recent_failures >= v_settings.failed_pin_limit THEN
    RAISE EXCEPTION 'Too many failed attempts. Try again in % minutes.', v_settings.failed_pin_lockout_minutes
      USING ERRCODE = '42901';
  END IF;

  v_stored_hash := v_settings.evacuation_pin_hash;
  v_ok := (p_pin IS NOT NULL AND v_stored_hash = extensions.crypt(p_pin, v_stored_hash));

  INSERT INTO public.presence_fire_safety_evacuation_pin_attempts (
    company_id, site_id, attempted_by_employee_id, success
  ) VALUES (p_company_id, p_site_id, v_caller.id, v_ok);

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Incorrect PIN' USING ERRCODE = '28000';
  END IF;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + make_interval(mins => v_settings.evacuation_unlock_duration_minutes);

  INSERT INTO public.presence_fire_safety_evacuation_unlocks (
    company_id, site_id, employee_id, token_hash, expires_at
  ) VALUES (p_company_id, p_site_id, v_caller.id, encode(digest(v_raw_token, 'sha256'), 'hex'), v_expires);

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, site_id, actor_employee_id, action, entity_type)
  VALUES (p_company_id, p_site_id, v_caller.id, 'evacuation_pin_verified', 'evacuation_unlock');

  RETURN QUERY SELECT v_raw_token, v_expires;
END;
$$;

-- Kiosk exit PIN: same optional-site-id pattern as evacuation's.
DROP FUNCTION IF EXISTS public.presence_fire_safety_set_kiosk_exit_pin(uuid, text);
CREATE FUNCTION public.presence_fire_safety_set_kiosk_exit_pin(p_company_id uuid, p_pin text, p_site_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_caller public.core_employees;
BEGIN
  IF NOT public.presence_fire_safety_has_permission(p_company_id, 'presence.manage_settings') THEN
    RAISE EXCEPTION 'Missing permission: presence.manage_settings' USING ERRCODE = '42501';
  END IF;
  v_caller := public.presence_fire_safety_current_employee(p_company_id);

  IF p_pin IS NULL OR length(p_pin) < 4 OR length(p_pin) > 12 OR p_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN must be 4-12 digits' USING ERRCODE = '22023';
  END IF;

  IF p_site_id IS NULL THEN
    INSERT INTO public.presence_fire_safety_settings (company_id, kiosk_exit_pin_hash, updated_by)
    VALUES (p_company_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), v_caller.id)
    ON CONFLICT (company_id) DO UPDATE SET
      kiosk_exit_pin_hash = EXCLUDED.kiosk_exit_pin_hash, updated_by = v_caller.id, updated_at = now();
  ELSE
    INSERT INTO public.presence_fire_safety_site_settings (company_id, site_id, kiosk_exit_pin_hash, updated_by)
    VALUES (p_company_id, p_site_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), v_caller.id)
    ON CONFLICT (company_id, site_id) DO UPDATE SET
      kiosk_exit_pin_hash = EXCLUDED.kiosk_exit_pin_hash, updated_by = v_caller.id, updated_at = now();
  END IF;

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, actor_employee_id, action, entity_type, entity_id)
  VALUES (p_company_id, v_caller.id, 'kiosk_exit_pin_set', 'settings', NULL);

  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_set_kiosk_exit_pin(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_set_kiosk_exit_pin(uuid, text, uuid) TO authenticated;

-- Kiosk exit PIN verify: gains p_site_id (was company-only before, since
-- kiosk toggling didn't previously carry site context) so it can resolve
-- the effective PIN for whichever site is currently selected on the device.
DROP FUNCTION IF EXISTS public.presence_fire_safety_verify_kiosk_exit_pin(uuid, text);
CREATE FUNCTION public.presence_fire_safety_verify_kiosk_exit_pin(p_company_id uuid, p_site_id uuid, p_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_caller public.core_employees;
  v_settings public.presence_fire_safety_settings;
  v_recent_failures integer;
  v_lockout_window interval;
  v_ok boolean;
BEGIN
  v_caller := public.presence_fire_safety_current_employee(p_company_id);
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings FROM public.presence_fire_safety_effective_settings(p_company_id, p_site_id);
  IF v_settings.kiosk_exit_pin_hash IS NULL THEN
    RAISE EXCEPTION 'No kiosk exit PIN has been configured for this site' USING ERRCODE = '42501';
  END IF;

  v_lockout_window := make_interval(mins => v_settings.failed_pin_lockout_minutes);

  SELECT count(*) INTO v_recent_failures
  FROM public.presence_fire_safety_kiosk_pin_attempts
  WHERE company_id = p_company_id
    AND attempted_by_employee_id = v_caller.id
    AND success = false
    AND created_at > now() - v_lockout_window;

  IF v_recent_failures >= v_settings.failed_pin_limit THEN
    RAISE EXCEPTION 'Too many failed attempts. Try again in % minutes.', v_settings.failed_pin_lockout_minutes
      USING ERRCODE = '42901';
  END IF;

  v_ok := (p_pin IS NOT NULL AND v_settings.kiosk_exit_pin_hash = extensions.crypt(p_pin, v_settings.kiosk_exit_pin_hash));

  INSERT INTO public.presence_fire_safety_kiosk_pin_attempts (company_id, site_id, attempted_by_employee_id, success)
  VALUES (p_company_id, p_site_id, v_caller.id, v_ok);

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Incorrect PIN' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, site_id, actor_employee_id, action, entity_type)
  VALUES (p_company_id, p_site_id, v_caller.id, 'kiosk_mode_exited_via_pin', 'settings');

  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_verify_kiosk_exit_pin(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_verify_kiosk_exit_pin(uuid, uuid, text) TO authenticated;
