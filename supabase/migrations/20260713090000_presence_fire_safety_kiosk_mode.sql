-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 11: Kiosk mode exit PIN
-- Kiosk mode itself is a pure client-side UI state (no company data is
-- exposed differently), so it needs no RLS changes — but exiting it back to
-- full admin mode is gated by a dedicated PIN, deliberately separate from
-- the fire evacuation PIN (a fire marshal knowing the evacuation PIN should
-- not thereby also be able to unlock kiosk devices, and vice versa).
-- ============================================================================

ALTER TABLE public.presence_fire_safety_settings
  ADD COLUMN IF NOT EXISTS kiosk_exit_pin_hash text;

-- Every kiosk-exit PIN attempt, success or failure, for rate limiting/lockout
-- and audit — mirrors presence_fire_safety_evacuation_pin_attempts. The
-- submitted PIN itself is never stored.
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_kiosk_pin_attempts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  attempted_by_employee_id  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  success                   boolean NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pfs_kiosk_pin_attempts_company_idx ON public.presence_fire_safety_kiosk_pin_attempts(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pfs_kiosk_pin_attempts_employee_idx ON public.presence_fire_safety_kiosk_pin_attempts(attempted_by_employee_id, created_at DESC);

ALTER TABLE public.presence_fire_safety_kiosk_pin_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY pfs_kiosk_pin_attempts_select ON public.presence_fire_safety_kiosk_pin_attempts
  FOR SELECT USING (
    company_id IN (
      SELECT ce.company_id FROM public.core_employees ce
      WHERE ce.auth_user_id = auth.uid() AND ce.role IN ('owner', 'admin', 'administrator')
    )
  );
-- No client INSERT policy — writes only happen inside the SECURITY DEFINER
-- verify RPC below, same pattern as the evacuation PIN attempts table.

-- ----------------------------------------------------------------------------
-- RPC: presence_fire_safety_set_kiosk_exit_pin
-- Administrators only (presence.manage_settings). Hashes with bcrypt
-- (pgcrypto), never stores plaintext.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presence_fire_safety_set_kiosk_exit_pin(
  p_company_id uuid,
  p_pin text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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

  INSERT INTO public.presence_fire_safety_settings (company_id, kiosk_exit_pin_hash, updated_by)
  VALUES (p_company_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), v_caller.id)
  ON CONFLICT (company_id) DO UPDATE SET
    kiosk_exit_pin_hash = EXCLUDED.kiosk_exit_pin_hash, updated_by = v_caller.id, updated_at = now();

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, actor_employee_id, action, entity_type, entity_id)
  VALUES (p_company_id, v_caller.id, 'kiosk_exit_pin_set', 'settings', NULL);

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_set_kiosk_exit_pin FROM PUBLIC;
REVOKE ALL ON FUNCTION public.presence_fire_safety_set_kiosk_exit_pin FROM anon;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_set_kiosk_exit_pin TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: presence_fire_safety_verify_kiosk_exit_pin
-- Any authenticated employee of the company may attempt this (the PIN is the
-- security boundary, not a permission — kiosk mode is meant to be exited by
-- whoever the device operator hands it to, who may not hold any elevated
-- permission themselves). Rate-limited/lockout using the same
-- failed_pin_limit / failed_pin_lockout_minutes settings as the evacuation
-- PIN. Raises on incorrect PIN or lockout; returns true on success.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presence_fire_safety_verify_kiosk_exit_pin(
  p_company_id uuid,
  p_pin text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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

  SELECT * INTO v_settings FROM public.presence_fire_safety_settings WHERE company_id = p_company_id;
  IF v_settings.kiosk_exit_pin_hash IS NULL THEN
    RAISE EXCEPTION 'No kiosk exit PIN has been configured for this company' USING ERRCODE = '42501';
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

  INSERT INTO public.presence_fire_safety_kiosk_pin_attempts (company_id, attempted_by_employee_id, success)
  VALUES (p_company_id, v_caller.id, v_ok);

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Incorrect PIN' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, actor_employee_id, action, entity_type)
  VALUES (p_company_id, v_caller.id, 'kiosk_mode_exited_via_pin', 'settings');

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_verify_kiosk_exit_pin FROM PUBLIC;
REVOKE ALL ON FUNCTION public.presence_fire_safety_verify_kiosk_exit_pin FROM anon;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_verify_kiosk_exit_pin TO authenticated;
