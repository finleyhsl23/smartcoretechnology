-- ── Leaving PIN ─────────────────────────────────────────────────────────
-- A weekly-rotating shared PIN for designated "leaving access" employees —
-- whoever is last to leave the building can PIN in, see who the register
-- still shows as signed in, and flag anyone who forgot to sign out (which
-- emails the configured query address(es) and logs who flagged whom).

ALTER TABLE public.presence_fire_safety_settings
  ADD COLUMN IF NOT EXISTS leaving_pin_hash text,
  ADD COLUMN IF NOT EXISTS leaving_pin_rotated_at timestamptz,
  ADD COLUMN IF NOT EXISTS leaving_pin_query_emails jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Designated leaving-PIN holders — everyone here shares the one rotating
-- PIN, so if the usual person can't do it, anyone else on this list can.
CREATE TABLE public.presence_fire_safety_leaving_pin_holders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  added_by uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id)
);
ALTER TABLE public.presence_fire_safety_leaving_pin_holders ENABLE ROW LEVEL SECURITY;
CREATE POLICY pfs_leaving_pin_holders_select ON public.presence_fire_safety_leaving_pin_holders
  FOR SELECT USING (public.presence_fire_safety_has_permission(company_id, 'presence.manage_settings'));
CREATE POLICY pfs_leaving_pin_holders_write ON public.presence_fire_safety_leaving_pin_holders
  FOR ALL USING (public.presence_fire_safety_has_permission(company_id, 'presence.manage_settings'))
  WITH CHECK (public.presence_fire_safety_has_permission(company_id, 'presence.manage_settings'));

-- Lockout tracking, mirrors presence_fire_safety_kiosk_pin_attempts exactly.
CREATE TABLE public.presence_fire_safety_leaving_pin_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  attempted_by_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.presence_fire_safety_leaving_pin_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY pfs_leaving_pin_attempts_select ON public.presence_fire_safety_leaving_pin_attempts
  FOR SELECT USING (company_id IN (
    SELECT ce.company_id FROM public.core_employees ce
    WHERE ce.auth_user_id = auth.uid() AND ce.role = ANY (ARRAY['owner','admin','administrator'])
  ));

-- Short-lived unlock issued on a correct PIN (mirrors evacuation_unlocks) —
-- the flag action requires one of these, not just PIN-holder membership, so
-- flagging someone always requires having actually just entered the PIN.
CREATE TABLE public.presence_fire_safety_leaving_pin_unlocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  employee_id uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
ALTER TABLE public.presence_fire_safety_leaving_pin_unlocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY pfs_leaving_pin_unlocks_select ON public.presence_fire_safety_leaving_pin_unlocks
  FOR SELECT USING (company_id IN (
    SELECT ce.company_id FROM public.core_employees ce
    WHERE ce.auth_user_id = auth.uid() AND ce.role = ANY (ARRAY['owner','admin','administrator'])
  ));

-- Log of who got flagged as not signed out, by whom, and when — viewable
-- by admins/owners as a record, not just a one-off email that could get lost.
CREATE TABLE public.presence_fire_safety_leaving_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  flagged_employee_id uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  flagged_by_employee_id uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE SET NULL,
  flagged_at timestamptz NOT NULL DEFAULT now(),
  notified_emails jsonb NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE public.presence_fire_safety_leaving_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY pfs_leaving_flags_select ON public.presence_fire_safety_leaving_flags
  FOR SELECT USING (company_id IN (
    SELECT ce.company_id FROM public.core_employees ce
    WHERE ce.auth_user_id = auth.uid() AND ce.role = ANY (ARRAY['owner','admin','administrator'])
  ));

-- Rotates the shared leaving PIN and returns the new plaintext PIN (only
-- ever returned here, right at rotation time, for the caller to email out
-- — never stored or returned again afterwards). Callable by an admin
-- (manual "Rotate now" in Settings) or by the weekly cron job via the
-- service role — nobody else.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_rotate_leaving_pin(p_company_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_caller public.core_employees;
  v_new_pin text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF NOT public.presence_fire_safety_has_permission(p_company_id, 'presence.manage_settings') THEN
      RAISE EXCEPTION 'Missing permission: presence.manage_settings' USING ERRCODE = '42501';
    END IF;
    v_caller := public.presence_fire_safety_current_employee(p_company_id);
  END IF;

  v_new_pin := lpad(floor(random() * 10000)::int::text, 4, '0');

  INSERT INTO public.presence_fire_safety_settings (company_id, leaving_pin_hash, leaving_pin_rotated_at, updated_by)
  VALUES (p_company_id, extensions.crypt(v_new_pin, extensions.gen_salt('bf', 12)), now(), v_caller.id)
  ON CONFLICT (company_id) DO UPDATE SET
    leaving_pin_hash = EXCLUDED.leaving_pin_hash,
    leaving_pin_rotated_at = now(),
    updated_by = COALESCE(v_caller.id, public.presence_fire_safety_settings.updated_by),
    updated_at = now();

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, actor_employee_id, action, entity_type)
  VALUES (p_company_id, v_caller.id, 'leaving_pin_rotated', 'settings');

  RETURN v_new_pin;
END;
$$;

-- Verifies the leaving PIN for the calling employee (who must be a
-- designated holder) and issues a 15-minute unlock token, same shape as
-- verify_evacuation_pin — this is a deliberate, time-boxed action, not a
-- standing permission, so the token expires quickly rather than staying
-- valid indefinitely once someone's on the holders list.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_verify_leaving_pin(p_company_id uuid, p_site_id uuid, p_pin text)
RETURNS TABLE(unlock_token text, expires_at timestamptz)
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
  v_raw_token text;
  v_expires timestamptz;
BEGIN
  IF NOT public.presence_fire_safety_has_site_access(p_company_id, p_site_id) THEN
    RAISE EXCEPTION 'No access to this site' USING ERRCODE = '42501';
  END IF;

  v_caller := public.presence_fire_safety_current_employee(p_company_id);
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.presence_fire_safety_leaving_pin_holders h
    WHERE h.company_id = p_company_id AND h.employee_id = v_caller.id
  ) THEN
    RAISE EXCEPTION 'You do not have leaving PIN access' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_settings FROM public.presence_fire_safety_settings WHERE company_id = p_company_id;
  IF v_settings.leaving_pin_hash IS NULL THEN
    RAISE EXCEPTION 'No leaving PIN has been set up for this company yet' USING ERRCODE = '42501';
  END IF;

  v_lockout_window := make_interval(mins => v_settings.failed_pin_lockout_minutes);

  SELECT count(*) INTO v_recent_failures
  FROM public.presence_fire_safety_leaving_pin_attempts
  WHERE company_id = p_company_id
    AND attempted_by_employee_id = v_caller.id
    AND success = false
    AND created_at > now() - v_lockout_window;

  IF v_recent_failures >= v_settings.failed_pin_limit THEN
    RAISE EXCEPTION 'Too many failed attempts. Try again in % minutes.', v_settings.failed_pin_lockout_minutes
      USING ERRCODE = '42901';
  END IF;

  v_ok := (p_pin IS NOT NULL AND v_settings.leaving_pin_hash = extensions.crypt(p_pin, v_settings.leaving_pin_hash));

  INSERT INTO public.presence_fire_safety_leaving_pin_attempts (company_id, site_id, attempted_by_employee_id, success)
  VALUES (p_company_id, p_site_id, v_caller.id, v_ok);

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Incorrect PIN' USING ERRCODE = '28000';
  END IF;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + interval '15 minutes';

  INSERT INTO public.presence_fire_safety_leaving_pin_unlocks (company_id, site_id, employee_id, token_hash, expires_at)
  VALUES (p_company_id, p_site_id, v_caller.id, encode(digest(v_raw_token, 'sha256'), 'hex'), v_expires);

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, site_id, actor_employee_id, action, entity_type)
  VALUES (p_company_id, p_site_id, v_caller.id, 'leaving_pin_verified', 'leaving_pin_unlock');

  RETURN QUERY SELECT v_raw_token, v_expires;
END;
$$;

-- Records that someone was still shown as signed in when the leaving PIN
-- was used — requires a live unlock token from verify_leaving_pin, so this
-- can only follow an actual PIN entry, not just holder-list membership.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_flag_not_signed_out(
  p_company_id uuid, p_site_id uuid, p_flagged_employee_id uuid, p_unlock_token text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_caller public.core_employees;
  v_token_hash text;
  v_unlock public.presence_fire_safety_leaving_pin_unlocks;
BEGIN
  v_caller := public.presence_fire_safety_current_employee(p_company_id);
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found' USING ERRCODE = '42501';
  END IF;

  v_token_hash := encode(digest(coalesce(p_unlock_token, ''), 'sha256'), 'hex');
  SELECT * INTO v_unlock FROM public.presence_fire_safety_leaving_pin_unlocks
  WHERE company_id = p_company_id AND employee_id = v_caller.id AND token_hash = v_token_hash
    AND revoked_at IS NULL AND expires_at > now()
  ORDER BY unlocked_at DESC LIMIT 1;

  IF v_unlock.id IS NULL THEN
    RAISE EXCEPTION 'Leaving PIN verification has expired — enter the PIN again' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.presence_fire_safety_leaving_flags (company_id, site_id, flagged_employee_id, flagged_by_employee_id)
  VALUES (p_company_id, p_site_id, p_flagged_employee_id, v_caller.id);

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, site_id, actor_employee_id, action, entity_type, entity_id)
  VALUES (p_company_id, p_site_id, v_caller.id, 'leaving_pin_flagged_not_signed_out', 'employee', p_flagged_employee_id);

  RETURN true;
END;
$$;

-- ── Timesheets permission (admin/owner only by default) ────────────────
-- presence_fire_safety_has_permission() already grants owner/admin/
-- administrator every permission unconditionally by role, so no change is
-- needed there or in default_permissions() — only my_permissions() (what
-- the client actually caches and checks against for nav/page gating) needs
-- the new key added to its owner/admin/administrator branch. Deliberately
-- left out of every other role's defaults so it stays admin/owner-only
-- unless an admin explicitly grants it via presence_fire_safety_permission_grants.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_my_permissions(p_company_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN ce.role IN ('owner', 'admin', 'administrator') THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.sign_others_in_out','presence.manage_visitors','presence.manage_contractors',
      'presence.export_reports','presence.manage_settings','presence.manage_badges',
      'evacuation.unlock','evacuation.start','evacuation.manage_roll_call','evacuation.complete','evacuation.export',
      'presence.view_timesheets'
    ]
    ELSE (
      SELECT array_agg(DISTINCT p) FROM (
        SELECT unnest(public.presence_fire_safety_default_permissions(ce.role)) AS p
        UNION
        SELECT g.permission FROM public.presence_fire_safety_permission_grants g
        WHERE g.company_id = p_company_id AND g.employee_id = ce.id
      ) perms
    )
  END
  FROM public.core_employees ce
  WHERE ce.auth_user_id = auth.uid() AND ce.company_id = p_company_id AND ce.auth_user_id IS NOT NULL
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_rotate_leaving_pin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_verify_leaving_pin(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_flag_not_signed_out(uuid, uuid, uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.presence_fire_safety_rotate_leaving_pin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_verify_leaving_pin(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_flag_not_signed_out(uuid, uuid, uuid, text) TO authenticated;
