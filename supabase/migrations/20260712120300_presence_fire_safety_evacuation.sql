-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 4: Fire evacuation
-- PIN hashing uses pgcrypto's bcrypt (extensions.crypt/gen_salt) — a native,
-- audited implementation already installed in this project, avoiding any
-- custom crypto code in the edge/worker layer (which has no npm deps today).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.presence_fire_safety_evacuation_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id               uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  started_by_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_by_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  completed_at          timestamptz,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  assembly_point        text,
  notes                 text,
  snapshot_count        integer NOT NULL DEFAULT 0,
  safe_count            integer NOT NULL DEFAULT 0,
  missing_count         integer NOT NULL DEFAULT 0,
  unaccounted_count     integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pfs_evac_sessions_company_idx ON public.presence_fire_safety_evacuation_sessions(company_id, started_at DESC);
-- Only one active evacuation session per site at a time.
CREATE UNIQUE INDEX IF NOT EXISTS pfs_evac_sessions_one_active_per_site
  ON public.presence_fire_safety_evacuation_sessions(site_id) WHERE status = 'active';

DROP TRIGGER IF EXISTS pfs_evac_sessions_set_updated_at ON public.presence_fire_safety_evacuation_sessions;
CREATE TRIGGER pfs_evac_sessions_set_updated_at BEFORE UPDATE ON public.presence_fire_safety_evacuation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Immutable snapshot of everyone onsite when the evacuation started.
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_evacuation_people (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id                 uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  evacuation_session_id   uuid NOT NULL REFERENCES public.presence_fire_safety_evacuation_sessions(id) ON DELETE CASCADE,
  subject_type            text NOT NULL CHECK (subject_type IN ('employee','visitor','contractor')),
  employee_id             uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  visitor_visit_id        uuid REFERENCES public.presence_fire_safety_visitor_visits(id) ON DELETE SET NULL,
  contractor_visit_id     uuid REFERENCES public.presence_fire_safety_contractor_visits(id) ON DELETE SET NULL,
  display_name_snapshot   text NOT NULL,
  department_snapshot     text,
  sign_in_time_snapshot   timestamptz,
  roll_call_status        text NOT NULL DEFAULT 'unaccounted'
    CHECK (roll_call_status IN ('unaccounted','safe','missing','left_before_roll_call','not_expected','other')),
  marked_by_employee_id   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  marked_at               timestamptz,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pfs_evac_people_session_idx ON public.presence_fire_safety_evacuation_people(evacuation_session_id);
CREATE INDEX IF NOT EXISTS pfs_evac_people_status_idx ON public.presence_fire_safety_evacuation_people(evacuation_session_id, roll_call_status);

DROP TRIGGER IF EXISTS pfs_evac_people_set_updated_at ON public.presence_fire_safety_evacuation_people;
CREATE TRIGGER pfs_evac_people_set_updated_at BEFORE UPDATE ON public.presence_fire_safety_evacuation_people
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Every PIN attempt, success or failure, for rate limiting/lockout and audit.
-- The submitted PIN itself is never stored here.
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_evacuation_pin_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id             uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  attempted_by_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  success             boolean NOT NULL,
  ip_address          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pfs_pin_attempts_company_idx ON public.presence_fire_safety_evacuation_pin_attempts(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pfs_pin_attempts_employee_idx ON public.presence_fire_safety_evacuation_pin_attempts(attempted_by_employee_id, created_at DESC);

-- Short-lived, server-verified unlock record. token_hash stores a hash of the
-- opaque bearer token handed to the client — the raw token is never stored.
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_evacuation_unlocks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id       uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  unlocked_at   timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS pfs_evac_unlocks_site_idx ON public.presence_fire_safety_evacuation_unlocks(site_id, expires_at DESC);

ALTER TABLE public.presence_fire_safety_evacuation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_fire_safety_evacuation_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_fire_safety_evacuation_pin_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_fire_safety_evacuation_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY pfs_evac_sessions_select ON public.presence_fire_safety_evacuation_sessions
  FOR SELECT USING (
    public.presence_fire_safety_has_permission(company_id, 'presence.view_live_register')
    AND public.presence_fire_safety_has_site_access(company_id, site_id)
  );
-- All writes to sessions go through the SECURITY DEFINER RPCs below; no
-- direct client INSERT/UPDATE policy is defined.

CREATE POLICY pfs_evac_people_select ON public.presence_fire_safety_evacuation_people
  FOR SELECT USING (
    public.presence_fire_safety_has_permission(company_id, 'presence.view_live_register')
    AND public.presence_fire_safety_has_site_access(company_id, site_id)
  );
-- Roll-call updates go through presence_fire_safety_update_roll_call only.

CREATE POLICY pfs_pin_attempts_select ON public.presence_fire_safety_evacuation_pin_attempts
  FOR SELECT USING (
    company_id IN (
      SELECT ce.company_id FROM public.core_employees ce
      WHERE ce.auth_user_id = auth.uid() AND ce.role IN ('owner', 'admin', 'administrator')
    )
  );

CREATE POLICY pfs_evac_unlocks_select ON public.presence_fire_safety_evacuation_unlocks
  FOR SELECT USING (
    employee_id IN (SELECT ce.id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- RPC: presence_fire_safety_set_evacuation_pin
-- Administrators only. Hashes with bcrypt (pgcrypto), never stores plaintext.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presence_fire_safety_set_evacuation_pin(
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

  INSERT INTO public.presence_fire_safety_settings (company_id, evacuation_pin_hash, updated_by)
  VALUES (p_company_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 12)), v_caller.id)
  ON CONFLICT (company_id) DO UPDATE SET
    evacuation_pin_hash = EXCLUDED.evacuation_pin_hash, updated_by = v_caller.id, updated_at = now();

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, actor_employee_id, action, entity_type, entity_id)
  VALUES (p_company_id, v_caller.id, 'evacuation_pin_set', 'settings', NULL);

  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_set_evacuation_pin FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_set_evacuation_pin TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: presence_fire_safety_verify_evacuation_pin
-- Rate-limited, lockout-enforced, audited. Never logs the submitted PIN.
-- Returns a one-time opaque unlock token (raw) — only its hash is persisted.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presence_fire_safety_verify_evacuation_pin(
  p_company_id uuid,
  p_site_id uuid,
  p_pin text
)
RETURNS TABLE(unlock_token text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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

  SELECT * INTO v_settings FROM public.presence_fire_safety_settings WHERE company_id = p_company_id;
  IF v_settings.evacuation_pin_hash IS NULL THEN
    RAISE EXCEPTION 'No evacuation PIN has been configured for this company' USING ERRCODE = '42501';
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
REVOKE ALL ON FUNCTION public.presence_fire_safety_verify_evacuation_pin FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_verify_evacuation_pin TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: presence_fire_safety_start_evacuation
-- Verifies the unlock token, confirms no conflicting active session, then
-- snapshots current presence into evacuation_people transactionally.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presence_fire_safety_start_evacuation(
  p_company_id uuid,
  p_site_id uuid,
  p_unlock_token text,
  p_assembly_point text DEFAULT NULL
)
RETURNS public.presence_fire_safety_evacuation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller public.core_employees;
  v_token_hash text;
  v_unlock public.presence_fire_safety_evacuation_unlocks;
  v_session public.presence_fire_safety_evacuation_sessions;
  v_count integer;
BEGIN
  IF NOT public.presence_fire_safety_has_permission(p_company_id, 'evacuation.start') THEN
    RAISE EXCEPTION 'Missing permission: evacuation.start' USING ERRCODE = '42501';
  END IF;
  IF NOT public.presence_fire_safety_has_site_access(p_company_id, p_site_id) THEN
    RAISE EXCEPTION 'No access to this site' USING ERRCODE = '42501';
  END IF;

  v_caller := public.presence_fire_safety_current_employee(p_company_id);
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found' USING ERRCODE = '42501';
  END IF;

  v_token_hash := encode(digest(p_unlock_token, 'sha256'), 'hex');
  SELECT * INTO v_unlock FROM public.presence_fire_safety_evacuation_unlocks
  WHERE token_hash = v_token_hash AND company_id = p_company_id AND site_id = p_site_id
    AND employee_id = v_caller.id AND revoked_at IS NULL AND expires_at > now();

  IF v_unlock.id IS NULL THEN
    RAISE EXCEPTION 'Evacuation unlock is invalid or has expired' USING ERRCODE = '28000';
  END IF;

  -- Serialise concurrent start attempts for this site.
  PERFORM 1 FROM public.presence_fire_safety_evacuation_sessions
  WHERE site_id = p_site_id AND status = 'active' FOR UPDATE;

  SELECT count(*) INTO v_count FROM public.presence_fire_safety_evacuation_sessions
  WHERE site_id = p_site_id AND status = 'active';
  IF v_count > 0 THEN
    RAISE EXCEPTION 'An evacuation is already active for this site' USING ERRCODE = '42710';
  END IF;

  INSERT INTO public.presence_fire_safety_evacuation_sessions (
    company_id, site_id, started_by_employee_id, assembly_point
  ) VALUES (p_company_id, p_site_id, v_caller.id, p_assembly_point)
  RETURNING * INTO v_session;

  INSERT INTO public.presence_fire_safety_evacuation_people (
    company_id, site_id, evacuation_session_id, subject_type,
    employee_id, visitor_visit_id, contractor_visit_id,
    display_name_snapshot, department_snapshot, sign_in_time_snapshot
  )
  SELECT
    p_company_id, p_site_id, v_session.id, cp.subject_type,
    cp.employee_id, cp.visitor_visit_id, cp.contractor_visit_id,
    CASE
      WHEN cp.subject_type = 'employee' THEN ce.full_name
      WHEN cp.subject_type = 'visitor' THEN vv_name.first_name || ' ' || vv_name.last_name
      ELSE ct.business_name
    END,
    CASE WHEN cp.subject_type = 'employee' THEN dept.name ELSE NULL END,
    cp.last_seen_at
  FROM public.presence_fire_safety_current_presence cp
  LEFT JOIN public.core_employees ce ON ce.id = cp.employee_id
  LEFT JOIN public.core_departments dept ON dept.id = ce.department_id
  LEFT JOIN public.presence_fire_safety_visitor_visits vv ON vv.id = cp.visitor_visit_id
  LEFT JOIN public.presence_fire_safety_visitors vv_name ON vv_name.id = vv.visitor_id
  LEFT JOIN public.presence_fire_safety_contractor_visits cv ON cv.id = cp.contractor_visit_id
  LEFT JOIN public.presence_fire_safety_contractors ct ON ct.id = cv.contractor_id
  WHERE cp.company_id = p_company_id AND cp.site_id = p_site_id AND cp.current_status = 'in';

  UPDATE public.presence_fire_safety_evacuation_sessions
  SET snapshot_count = (SELECT count(*) FROM public.presence_fire_safety_evacuation_people WHERE evacuation_session_id = v_session.id),
      unaccounted_count = (SELECT count(*) FROM public.presence_fire_safety_evacuation_people WHERE evacuation_session_id = v_session.id AND roll_call_status = 'unaccounted')
  WHERE id = v_session.id
  RETURNING * INTO v_session;

  UPDATE public.presence_fire_safety_evacuation_unlocks SET revoked_at = now() WHERE id = v_unlock.id;

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, site_id, actor_employee_id, action, entity_type, entity_id, new_values)
  VALUES (p_company_id, p_site_id, v_caller.id, 'evacuation_started', 'evacuation_session', v_session.id,
          jsonb_build_object('snapshot_count', v_session.snapshot_count));

  RETURN v_session;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_start_evacuation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_start_evacuation TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: presence_fire_safety_update_roll_call
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presence_fire_safety_update_roll_call(
  p_evacuation_person_id uuid,
  p_roll_call_status text,
  p_notes text DEFAULT NULL
)
RETURNS public.presence_fire_safety_evacuation_people
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller public.core_employees;
  v_person public.presence_fire_safety_evacuation_people;
  v_session public.presence_fire_safety_evacuation_sessions;
BEGIN
  SELECT * INTO v_person FROM public.presence_fire_safety_evacuation_people WHERE id = p_evacuation_person_id;
  IF v_person.id IS NULL THEN
    RAISE EXCEPTION 'Evacuation record not found' USING ERRCODE = '02000';
  END IF;

  IF NOT public.presence_fire_safety_has_permission(v_person.company_id, 'evacuation.manage_roll_call') THEN
    RAISE EXCEPTION 'Missing permission: evacuation.manage_roll_call' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_session FROM public.presence_fire_safety_evacuation_sessions WHERE id = v_person.evacuation_session_id;
  IF v_session.status <> 'active' THEN
    RAISE EXCEPTION 'This evacuation session is no longer active' USING ERRCODE = '55000';
  END IF;

  IF p_roll_call_status NOT IN ('unaccounted','safe','missing','left_before_roll_call','not_expected','other') THEN
    RAISE EXCEPTION 'Invalid roll_call_status' USING ERRCODE = '22023';
  END IF;

  v_caller := public.presence_fire_safety_current_employee(v_person.company_id);

  UPDATE public.presence_fire_safety_evacuation_people SET
    roll_call_status = p_roll_call_status,
    marked_by_employee_id = v_caller.id,
    marked_at = now(),
    notes = COALESCE(p_notes, notes)
  WHERE id = p_evacuation_person_id
  RETURNING * INTO v_person;

  UPDATE public.presence_fire_safety_evacuation_sessions SET
    safe_count = (SELECT count(*) FROM public.presence_fire_safety_evacuation_people WHERE evacuation_session_id = v_session.id AND roll_call_status = 'safe'),
    missing_count = (SELECT count(*) FROM public.presence_fire_safety_evacuation_people WHERE evacuation_session_id = v_session.id AND roll_call_status = 'missing'),
    unaccounted_count = (SELECT count(*) FROM public.presence_fire_safety_evacuation_people WHERE evacuation_session_id = v_session.id AND roll_call_status = 'unaccounted')
  WHERE id = v_session.id;

  RETURN v_person;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_update_roll_call FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_update_roll_call TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: presence_fire_safety_complete_evacuation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presence_fire_safety_complete_evacuation(
  p_session_id uuid
)
RETURNS public.presence_fire_safety_evacuation_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller public.core_employees;
  v_session public.presence_fire_safety_evacuation_sessions;
BEGIN
  SELECT * INTO v_session FROM public.presence_fire_safety_evacuation_sessions WHERE id = p_session_id;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Evacuation session not found' USING ERRCODE = '02000';
  END IF;

  IF NOT public.presence_fire_safety_has_permission(v_session.company_id, 'evacuation.complete') THEN
    RAISE EXCEPTION 'Missing permission: evacuation.complete' USING ERRCODE = '42501';
  END IF;
  IF v_session.status <> 'active' THEN
    RAISE EXCEPTION 'This evacuation session is not active' USING ERRCODE = '55000';
  END IF;

  v_caller := public.presence_fire_safety_current_employee(v_session.company_id);

  UPDATE public.presence_fire_safety_evacuation_sessions SET
    status = 'completed', completed_by_employee_id = v_caller.id, completed_at = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, site_id, actor_employee_id, action, entity_type, entity_id, new_values)
  VALUES (v_session.company_id, v_session.site_id, v_caller.id, 'evacuation_completed', 'evacuation_session', v_session.id,
          jsonb_build_object('safe_count', v_session.safe_count, 'missing_count', v_session.missing_count, 'unaccounted_count', v_session.unaccounted_count));

  RETURN v_session;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_complete_evacuation FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_complete_evacuation TO authenticated;
