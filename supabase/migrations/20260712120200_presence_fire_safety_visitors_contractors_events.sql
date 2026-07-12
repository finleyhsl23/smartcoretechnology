-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 3: Visitors, contractors,
-- append-only presence event ledger, current-presence, transactional RPCs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.presence_fire_safety_visitors (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  first_name            text NOT NULL,
  last_name             text NOT NULL,
  organisation          text,
  email                 text,
  phone                 text,
  photo_path            text,
  vehicle_registration  text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX IF NOT EXISTS pfs_visitors_company_idx ON public.presence_fire_safety_visitors(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pfs_visitors_name_idx ON public.presence_fire_safety_visitors(company_id, last_name, first_name);

DROP TRIGGER IF EXISTS pfs_visitors_set_updated_at ON public.presence_fire_safety_visitors;
CREATE TRIGGER pfs_visitors_set_updated_at BEFORE UPDATE ON public.presence_fire_safety_visitors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.presence_fire_safety_visitor_visits (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id                 uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  visitor_id              uuid NOT NULL REFERENCES public.presence_fire_safety_visitors(id) ON DELETE CASCADE,
  host_employee_id        uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  visit_reason            text,
  expected_arrival_at     timestamptz,
  signed_in_at            timestamptz,
  signed_out_at           timestamptz,
  badge_reference         text,
  status                  text NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected','signed_in','signed_out','cancelled')),
  accepted_site_terms_at  timestamptz,
  created_by              uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pfs_visitor_visits_company_idx ON public.presence_fire_safety_visitor_visits(company_id, site_id);
CREATE INDEX IF NOT EXISTS pfs_visitor_visits_visitor_idx ON public.presence_fire_safety_visitor_visits(visitor_id);
CREATE INDEX IF NOT EXISTS pfs_visitor_visits_status_idx ON public.presence_fire_safety_visitor_visits(site_id, status);

DROP TRIGGER IF EXISTS pfs_visitor_visits_set_updated_at ON public.presence_fire_safety_visitor_visits;
CREATE TRIGGER pfs_visitor_visits_set_updated_at BEFORE UPDATE ON public.presence_fire_safety_visitor_visits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.presence_fire_safety_contractors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  business_name text NOT NULL,
  contact_name  text,
  phone         text,
  email         text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS pfs_contractors_company_idx ON public.presence_fire_safety_contractors(company_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS pfs_contractors_set_updated_at ON public.presence_fire_safety_contractors;
CREATE TRIGGER pfs_contractors_set_updated_at BEFORE UPDATE ON public.presence_fire_safety_contractors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.presence_fire_safety_contractor_visits (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id               uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  contractor_id         uuid NOT NULL REFERENCES public.presence_fire_safety_contractors(id) ON DELETE CASCADE,
  host_employee_id      uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  work_purpose          text,
  permit_reference      text,
  vehicle_registration  text,
  induction_confirmed_at timestamptz,
  signed_in_at          timestamptz,
  signed_out_at         timestamptz,
  status                text NOT NULL DEFAULT 'expected'
    CHECK (status IN ('expected','signed_in','signed_out','cancelled')),
  created_by            uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pfs_contractor_visits_company_idx ON public.presence_fire_safety_contractor_visits(company_id, site_id);
CREATE INDEX IF NOT EXISTS pfs_contractor_visits_contractor_idx ON public.presence_fire_safety_contractor_visits(contractor_id);
CREATE INDEX IF NOT EXISTS pfs_contractor_visits_status_idx ON public.presence_fire_safety_contractor_visits(site_id, status);

DROP TRIGGER IF EXISTS pfs_contractor_visits_set_updated_at ON public.presence_fire_safety_contractor_visits;
CREATE TRIGGER pfs_contractor_visits_set_updated_at BEFORE UPDATE ON public.presence_fire_safety_contractor_visits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Append-only event ledger. No UPDATE/DELETE policy is ever defined for
-- ordinary roles — corrections are new rows referencing correction_of_event_id.
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id               uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  subject_type          text NOT NULL CHECK (subject_type IN ('employee','visitor','contractor')),
  employee_id           uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  visitor_visit_id      uuid REFERENCES public.presence_fire_safety_visitor_visits(id) ON DELETE SET NULL,
  contractor_visit_id   uuid REFERENCES public.presence_fire_safety_contractor_visits(id) ON DELETE SET NULL,
  direction             text NOT NULL CHECK (direction IN ('in','out')),
  method                text NOT NULL CHECK (method IN ('qr','manual','admin','kiosk','automatic','import','correction')),
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  recorded_by_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  device_id             uuid REFERENCES public.presence_fire_safety_devices(id) ON DELETE SET NULL,
  source_request_id     text,
  correction_of_event_id uuid REFERENCES public.presence_fire_safety_events(id) ON DELETE SET NULL,
  notes                 text,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pfs_events_one_subject CHECK (
    (subject_type = 'employee'   AND employee_id IS NOT NULL AND visitor_visit_id IS NULL AND contractor_visit_id IS NULL) OR
    (subject_type = 'visitor'    AND visitor_visit_id IS NOT NULL AND employee_id IS NULL AND contractor_visit_id IS NULL) OR
    (subject_type = 'contractor' AND contractor_visit_id IS NOT NULL AND employee_id IS NULL AND visitor_visit_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS pfs_events_company_site_idx ON public.presence_fire_safety_events(company_id, site_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS pfs_events_employee_idx ON public.presence_fire_safety_events(employee_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS pfs_events_visitor_visit_idx ON public.presence_fire_safety_events(visitor_visit_id);
CREATE INDEX IF NOT EXISTS pfs_events_contractor_visit_idx ON public.presence_fire_safety_events(contractor_visit_id);
-- Idempotency: a given source_request_id can only ever produce one event.
CREATE UNIQUE INDEX IF NOT EXISTS pfs_events_source_request_unique
  ON public.presence_fire_safety_events(company_id, source_request_id) WHERE source_request_id IS NOT NULL;

-- Latest authoritative state per subject, for fast live-register queries.
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_current_presence (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id             uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  subject_type        text NOT NULL CHECK (subject_type IN ('employee','visitor','contractor')),
  employee_id         uuid REFERENCES public.core_employees(id) ON DELETE CASCADE,
  visitor_visit_id    uuid REFERENCES public.presence_fire_safety_visitor_visits(id) ON DELETE CASCADE,
  contractor_visit_id uuid REFERENCES public.presence_fire_safety_contractor_visits(id) ON DELETE CASCADE,
  current_status      text NOT NULL CHECK (current_status IN ('in','out')),
  last_event_id       uuid NOT NULL REFERENCES public.presence_fire_safety_events(id) ON DELETE CASCADE,
  last_seen_at        timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- Exactly one current-presence row per subject (database-level, not app-level).
CREATE UNIQUE INDEX IF NOT EXISTS pfs_current_presence_one_per_employee
  ON public.presence_fire_safety_current_presence(company_id, employee_id) WHERE employee_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pfs_current_presence_one_per_visitor_visit
  ON public.presence_fire_safety_current_presence(company_id, visitor_visit_id) WHERE visitor_visit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pfs_current_presence_one_per_contractor_visit
  ON public.presence_fire_safety_current_presence(company_id, contractor_visit_id) WHERE contractor_visit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pfs_current_presence_site_status_idx
  ON public.presence_fire_safety_current_presence(company_id, site_id, current_status);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.presence_fire_safety_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_fire_safety_visitor_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_fire_safety_contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_fire_safety_contractor_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_fire_safety_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_fire_safety_current_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY pfs_visitors_select ON public.presence_fire_safety_visitors
  FOR SELECT USING (public.presence_fire_safety_has_permission(company_id, 'presence.view_live_register'));
CREATE POLICY pfs_visitors_write ON public.presence_fire_safety_visitors
  FOR ALL USING (public.presence_fire_safety_has_permission(company_id, 'presence.manage_visitors'))
  WITH CHECK (public.presence_fire_safety_has_permission(company_id, 'presence.manage_visitors'));

CREATE POLICY pfs_visitor_visits_select ON public.presence_fire_safety_visitor_visits
  FOR SELECT USING (
    public.presence_fire_safety_has_permission(company_id, 'presence.view_live_register')
    AND public.presence_fire_safety_has_site_access(company_id, site_id)
  );
CREATE POLICY pfs_visitor_visits_write ON public.presence_fire_safety_visitor_visits
  FOR ALL USING (
    public.presence_fire_safety_has_permission(company_id, 'presence.manage_visitors')
    AND public.presence_fire_safety_has_site_access(company_id, site_id)
  ) WITH CHECK (
    public.presence_fire_safety_has_permission(company_id, 'presence.manage_visitors')
    AND public.presence_fire_safety_has_site_access(company_id, site_id)
  );

CREATE POLICY pfs_contractors_select ON public.presence_fire_safety_contractors
  FOR SELECT USING (public.presence_fire_safety_has_permission(company_id, 'presence.view_live_register'));
CREATE POLICY pfs_contractors_write ON public.presence_fire_safety_contractors
  FOR ALL USING (public.presence_fire_safety_has_permission(company_id, 'presence.manage_contractors'))
  WITH CHECK (public.presence_fire_safety_has_permission(company_id, 'presence.manage_contractors'));

CREATE POLICY pfs_contractor_visits_select ON public.presence_fire_safety_contractor_visits
  FOR SELECT USING (
    public.presence_fire_safety_has_permission(company_id, 'presence.view_live_register')
    AND public.presence_fire_safety_has_site_access(company_id, site_id)
  );
CREATE POLICY pfs_contractor_visits_write ON public.presence_fire_safety_contractor_visits
  FOR ALL USING (
    public.presence_fire_safety_has_permission(company_id, 'presence.manage_contractors')
    AND public.presence_fire_safety_has_site_access(company_id, site_id)
  ) WITH CHECK (
    public.presence_fire_safety_has_permission(company_id, 'presence.manage_contractors')
    AND public.presence_fire_safety_has_site_access(company_id, site_id)
  );

-- Events: readable by anyone with live-register or own-history permission at
-- that site; own history always visible for the employee's own events.
-- No UPDATE/DELETE policy exists for any role — append-only, enforced by DB.
CREATE POLICY pfs_events_select ON public.presence_fire_safety_events
  FOR SELECT USING (
    (subject_type = 'employee' AND employee_id IN (SELECT ce.id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid()))
    OR (
      public.presence_fire_safety_has_permission(company_id, 'presence.view_live_register')
      AND public.presence_fire_safety_has_site_access(company_id, site_id)
    )
  );
CREATE POLICY pfs_events_insert ON public.presence_fire_safety_events
  FOR INSERT WITH CHECK (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

CREATE POLICY pfs_current_presence_select ON public.presence_fire_safety_current_presence
  FOR SELECT USING (
    (subject_type = 'employee' AND employee_id IN (SELECT ce.id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid()))
    OR (
      public.presence_fire_safety_has_permission(company_id, 'presence.view_live_register')
      AND public.presence_fire_safety_has_site_access(company_id, site_id)
    )
  );
-- No direct client INSERT/UPDATE policy — this table is only ever written by
-- the SECURITY DEFINER RPCs below, inside the same transaction as the event.

-- ----------------------------------------------------------------------------
-- RPC: presence_fire_safety_record_presence_event
-- Single transactional entry point: validates caller, permission and site
-- access, applies idempotency via source_request_id, writes the event AND
-- updates current_presence atomically, returns the resulting state.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presence_fire_safety_record_presence_event(
  p_company_id uuid,
  p_site_id uuid,
  p_subject_type text,
  p_direction text,
  p_method text,
  p_employee_id uuid DEFAULT NULL,
  p_visitor_visit_id uuid DEFAULT NULL,
  p_contractor_visit_id uuid DEFAULT NULL,
  p_device_id uuid DEFAULT NULL,
  p_source_request_id text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.presence_fire_safety_current_presence
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller public.core_employees;
  v_existing_event_id uuid;
  v_event_id uuid;
  v_result public.presence_fire_safety_current_presence;
  v_required_permission text;
BEGIN
  IF NOT public.presence_fire_safety_module_enabled(p_company_id) THEN
    RAISE EXCEPTION 'Presence & Fire Safety is not enabled for this company' USING ERRCODE = '42501';
  END IF;

  IF NOT public.presence_fire_safety_has_site_access(p_company_id, p_site_id) THEN
    RAISE EXCEPTION 'No access to this site' USING ERRCODE = '42501';
  END IF;

  v_caller := public.presence_fire_safety_current_employee(p_company_id);
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found' USING ERRCODE = '42501';
  END IF;

  v_required_permission := CASE
    WHEN p_subject_type = 'employee' AND p_employee_id = v_caller.id THEN 'presence.sign_self_in_out'
    ELSE 'presence.sign_others_in_out'
  END;
  IF NOT public.presence_fire_safety_has_permission(p_company_id, v_required_permission) THEN
    RAISE EXCEPTION 'Missing permission: %', v_required_permission USING ERRCODE = '42501';
  END IF;

  IF p_subject_type NOT IN ('employee','visitor','contractor') THEN
    RAISE EXCEPTION 'Invalid subject_type' USING ERRCODE = '22023';
  END IF;
  IF p_direction NOT IN ('in','out') THEN
    RAISE EXCEPTION 'Invalid direction' USING ERRCODE = '22023';
  END IF;

  -- Idempotency: replaying the same source_request_id returns the existing state.
  IF p_source_request_id IS NOT NULL THEN
    SELECT id INTO v_existing_event_id FROM public.presence_fire_safety_events
    WHERE company_id = p_company_id AND source_request_id = p_source_request_id;

    IF v_existing_event_id IS NOT NULL THEN
      SELECT * INTO v_result FROM public.presence_fire_safety_current_presence cp
      WHERE cp.last_event_id = v_existing_event_id
         OR (p_subject_type = 'employee' AND cp.employee_id = p_employee_id AND cp.company_id = p_company_id)
         OR (p_subject_type = 'visitor' AND cp.visitor_visit_id = p_visitor_visit_id AND cp.company_id = p_company_id)
         OR (p_subject_type = 'contractor' AND cp.contractor_visit_id = p_contractor_visit_id AND cp.company_id = p_company_id)
      LIMIT 1;
      RETURN v_result;
    END IF;
  END IF;

  -- Lock the relevant current_presence row (if any) to serialise concurrent scans.
  IF p_subject_type = 'employee' THEN
    PERFORM 1 FROM public.presence_fire_safety_current_presence
    WHERE company_id = p_company_id AND employee_id = p_employee_id FOR UPDATE;
  ELSIF p_subject_type = 'visitor' THEN
    PERFORM 1 FROM public.presence_fire_safety_current_presence
    WHERE company_id = p_company_id AND visitor_visit_id = p_visitor_visit_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.presence_fire_safety_current_presence
    WHERE company_id = p_company_id AND contractor_visit_id = p_contractor_visit_id FOR UPDATE;
  END IF;

  INSERT INTO public.presence_fire_safety_events (
    company_id, site_id, subject_type, employee_id, visitor_visit_id, contractor_visit_id,
    direction, method, recorded_by_employee_id, device_id, source_request_id, notes
  ) VALUES (
    p_company_id, p_site_id, p_subject_type, p_employee_id, p_visitor_visit_id, p_contractor_visit_id,
    p_direction, p_method, v_caller.id, p_device_id, p_source_request_id, p_notes
  ) RETURNING id INTO v_event_id;

  IF p_subject_type = 'employee' THEN
    INSERT INTO public.presence_fire_safety_current_presence (
      company_id, site_id, subject_type, employee_id, current_status, last_event_id, last_seen_at
    ) VALUES (p_company_id, p_site_id, p_subject_type, p_employee_id, p_direction, v_event_id, now())
    ON CONFLICT (company_id, employee_id) WHERE employee_id IS NOT NULL DO UPDATE SET
      site_id = EXCLUDED.site_id, current_status = EXCLUDED.current_status,
      last_event_id = EXCLUDED.last_event_id, last_seen_at = EXCLUDED.last_seen_at, updated_at = now()
    RETURNING * INTO v_result;

  ELSIF p_subject_type = 'visitor' THEN
    INSERT INTO public.presence_fire_safety_current_presence (
      company_id, site_id, subject_type, visitor_visit_id, current_status, last_event_id, last_seen_at
    ) VALUES (p_company_id, p_site_id, p_subject_type, p_visitor_visit_id, p_direction, v_event_id, now())
    ON CONFLICT (company_id, visitor_visit_id) WHERE visitor_visit_id IS NOT NULL DO UPDATE SET
      site_id = EXCLUDED.site_id, current_status = EXCLUDED.current_status,
      last_event_id = EXCLUDED.last_event_id, last_seen_at = EXCLUDED.last_seen_at, updated_at = now()
    RETURNING * INTO v_result;

    UPDATE public.presence_fire_safety_visitor_visits SET
      status = CASE WHEN p_direction = 'in' THEN 'signed_in' ELSE 'signed_out' END,
      signed_in_at = CASE WHEN p_direction = 'in' THEN COALESCE(signed_in_at, now()) ELSE signed_in_at END,
      signed_out_at = CASE WHEN p_direction = 'out' THEN now() ELSE signed_out_at END
    WHERE id = p_visitor_visit_id AND company_id = p_company_id;

  ELSIF p_subject_type = 'contractor' THEN
    INSERT INTO public.presence_fire_safety_current_presence (
      company_id, site_id, subject_type, contractor_visit_id, current_status, last_event_id, last_seen_at
    ) VALUES (p_company_id, p_site_id, p_subject_type, p_contractor_visit_id, p_direction, v_event_id, now())
    ON CONFLICT (company_id, contractor_visit_id) WHERE contractor_visit_id IS NOT NULL DO UPDATE SET
      site_id = EXCLUDED.site_id, current_status = EXCLUDED.current_status,
      last_event_id = EXCLUDED.last_event_id, last_seen_at = EXCLUDED.last_seen_at, updated_at = now()
    RETURNING * INTO v_result;

    UPDATE public.presence_fire_safety_contractor_visits SET
      status = CASE WHEN p_direction = 'in' THEN 'signed_in' ELSE 'signed_out' END,
      signed_in_at = CASE WHEN p_direction = 'in' THEN COALESCE(signed_in_at, now()) ELSE signed_in_at END,
      signed_out_at = CASE WHEN p_direction = 'out' THEN now() ELSE signed_out_at END
    WHERE id = p_contractor_visit_id AND company_id = p_company_id;
  END IF;

  INSERT INTO public.presence_fire_safety_audit_logs (
    company_id, site_id, actor_employee_id, action, entity_type, entity_id, new_values
  ) VALUES (
    p_company_id, p_site_id, v_caller.id, 'presence_event_recorded', p_subject_type,
    COALESCE(p_employee_id, p_visitor_visit_id, p_contractor_visit_id),
    jsonb_build_object('direction', p_direction, 'method', p_method, 'event_id', v_event_id)
  );

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_record_presence_event FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_record_presence_event TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: presence_fire_safety_create_visitor_visit
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presence_fire_safety_create_visitor_visit(
  p_company_id uuid,
  p_site_id uuid,
  p_first_name text,
  p_last_name text,
  p_organisation text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_vehicle_registration text DEFAULT NULL,
  p_host_employee_id uuid DEFAULT NULL,
  p_visit_reason text DEFAULT NULL,
  p_photo_path text DEFAULT NULL,
  p_accept_terms boolean DEFAULT false,
  p_sign_in_now boolean DEFAULT true
)
RETURNS public.presence_fire_safety_visitor_visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller public.core_employees;
  v_visitor_id uuid;
  v_visit public.presence_fire_safety_visitor_visits;
BEGIN
  IF NOT public.presence_fire_safety_module_enabled(p_company_id) THEN
    RAISE EXCEPTION 'Presence & Fire Safety is not enabled for this company' USING ERRCODE = '42501';
  END IF;
  IF NOT public.presence_fire_safety_has_site_access(p_company_id, p_site_id) THEN
    RAISE EXCEPTION 'No access to this site' USING ERRCODE = '42501';
  END IF;
  IF NOT public.presence_fire_safety_has_permission(p_company_id, 'presence.manage_visitors') THEN
    RAISE EXCEPTION 'Missing permission: presence.manage_visitors' USING ERRCODE = '42501';
  END IF;

  v_caller := public.presence_fire_safety_current_employee(p_company_id);
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found' USING ERRCODE = '42501';
  END IF;

  IF NOT (p_first_name IS NOT NULL AND length(trim(p_first_name)) > 0
      AND p_last_name IS NOT NULL AND length(trim(p_last_name)) > 0) THEN
    RAISE EXCEPTION 'First and last name are required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.presence_fire_safety_visitors (
    company_id, first_name, last_name, organisation, email, phone, photo_path, vehicle_registration
  ) VALUES (
    p_company_id, trim(p_first_name), trim(p_last_name), p_organisation, p_email, p_phone, p_photo_path, p_vehicle_registration
  ) RETURNING id INTO v_visitor_id;

  INSERT INTO public.presence_fire_safety_visitor_visits (
    company_id, site_id, visitor_id, host_employee_id, visit_reason,
    badge_reference, status, accepted_site_terms_at, created_by
  ) VALUES (
    p_company_id, p_site_id, v_visitor_id, p_host_employee_id, p_visit_reason,
    'V-' || to_char(now(), 'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
    'expected',
    CASE WHEN p_accept_terms THEN now() ELSE NULL END,
    v_caller.id
  ) RETURNING * INTO v_visit;

  IF p_sign_in_now THEN
    PERFORM public.presence_fire_safety_record_presence_event(
      p_company_id, p_site_id, 'visitor', 'in', 'manual',
      NULL, v_visit.id, NULL, NULL,
      'visitor-signin-' || v_visit.id::text, 'Visitor sign-in'
    );
    SELECT * INTO v_visit FROM public.presence_fire_safety_visitor_visits WHERE id = v_visit.id;
  END IF;

  RETURN v_visit;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_create_visitor_visit FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_create_visitor_visit TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: presence_fire_safety_sign_out_visitor
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presence_fire_safety_sign_out_visitor(
  p_company_id uuid,
  p_visitor_visit_id uuid
)
RETURNS public.presence_fire_safety_visitor_visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visit public.presence_fire_safety_visitor_visits;
BEGIN
  SELECT * INTO v_visit FROM public.presence_fire_safety_visitor_visits
  WHERE id = p_visitor_visit_id AND company_id = p_company_id;
  IF v_visit.id IS NULL THEN
    RAISE EXCEPTION 'Visitor visit not found' USING ERRCODE = '02000';
  END IF;

  PERFORM public.presence_fire_safety_record_presence_event(
    p_company_id, v_visit.site_id, 'visitor', 'out', 'manual',
    NULL, v_visit.id, NULL, NULL,
    'visitor-signout-' || v_visit.id::text, 'Visitor sign-out'
  );

  SELECT * INTO v_visit FROM public.presence_fire_safety_visitor_visits WHERE id = p_visitor_visit_id;
  RETURN v_visit;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_sign_out_visitor FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_sign_out_visitor TO authenticated;

-- ----------------------------------------------------------------------------
-- RPC: presence_fire_safety_create_contractor_visit / sign_out_contractor
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presence_fire_safety_create_contractor_visit(
  p_company_id uuid,
  p_site_id uuid,
  p_business_name text,
  p_contact_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_host_employee_id uuid DEFAULT NULL,
  p_work_purpose text DEFAULT NULL,
  p_permit_reference text DEFAULT NULL,
  p_vehicle_registration text DEFAULT NULL,
  p_induction_confirmed boolean DEFAULT false,
  p_sign_in_now boolean DEFAULT true
)
RETURNS public.presence_fire_safety_contractor_visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller public.core_employees;
  v_contractor_id uuid;
  v_visit public.presence_fire_safety_contractor_visits;
BEGIN
  IF NOT public.presence_fire_safety_module_enabled(p_company_id) THEN
    RAISE EXCEPTION 'Presence & Fire Safety is not enabled for this company' USING ERRCODE = '42501';
  END IF;
  IF NOT public.presence_fire_safety_has_site_access(p_company_id, p_site_id) THEN
    RAISE EXCEPTION 'No access to this site' USING ERRCODE = '42501';
  END IF;
  IF NOT public.presence_fire_safety_has_permission(p_company_id, 'presence.manage_contractors') THEN
    RAISE EXCEPTION 'Missing permission: presence.manage_contractors' USING ERRCODE = '42501';
  END IF;

  v_caller := public.presence_fire_safety_current_employee(p_company_id);
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found' USING ERRCODE = '42501';
  END IF;

  IF p_business_name IS NULL OR length(trim(p_business_name)) = 0 THEN
    RAISE EXCEPTION 'Business name is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.presence_fire_safety_contractors (company_id, business_name, contact_name, phone, email)
  VALUES (p_company_id, trim(p_business_name), p_contact_name, p_phone, p_email)
  RETURNING id INTO v_contractor_id;

  INSERT INTO public.presence_fire_safety_contractor_visits (
    company_id, site_id, contractor_id, host_employee_id, work_purpose, permit_reference,
    vehicle_registration, induction_confirmed_at, status, created_by
  ) VALUES (
    p_company_id, p_site_id, v_contractor_id, p_host_employee_id, p_work_purpose, p_permit_reference,
    p_vehicle_registration, CASE WHEN p_induction_confirmed THEN now() ELSE NULL END, 'expected', v_caller.id
  ) RETURNING * INTO v_visit;

  IF p_sign_in_now THEN
    PERFORM public.presence_fire_safety_record_presence_event(
      p_company_id, p_site_id, 'contractor', 'in', 'manual',
      NULL, NULL, v_visit.id, NULL,
      'contractor-signin-' || v_visit.id::text, 'Contractor sign-in'
    );
    SELECT * INTO v_visit FROM public.presence_fire_safety_contractor_visits WHERE id = v_visit.id;
  END IF;

  RETURN v_visit;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_create_contractor_visit FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_create_contractor_visit TO authenticated;

CREATE OR REPLACE FUNCTION public.presence_fire_safety_sign_out_contractor(
  p_company_id uuid,
  p_contractor_visit_id uuid
)
RETURNS public.presence_fire_safety_contractor_visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visit public.presence_fire_safety_contractor_visits;
BEGIN
  SELECT * INTO v_visit FROM public.presence_fire_safety_contractor_visits
  WHERE id = p_contractor_visit_id AND company_id = p_company_id;
  IF v_visit.id IS NULL THEN
    RAISE EXCEPTION 'Contractor visit not found' USING ERRCODE = '02000';
  END IF;

  PERFORM public.presence_fire_safety_record_presence_event(
    p_company_id, v_visit.site_id, 'contractor', 'out', 'manual',
    NULL, NULL, v_visit.id, NULL,
    'contractor-signout-' || v_visit.id::text, 'Contractor sign-out'
  );

  SELECT * INTO v_visit FROM public.presence_fire_safety_contractor_visits WHERE id = p_contractor_visit_id;
  RETURN v_visit;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_sign_out_contractor FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_sign_out_contractor TO authenticated;
