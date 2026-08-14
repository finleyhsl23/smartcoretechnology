-- Actually enforces the "Automatically sign everyone out at a fixed time"
-- Module Setting, which until now was a checkbox + time picker with
-- nothing behind it at all — turning it on had zero effect.
--
-- One idempotent, self-contained function per site: resolves that site's
-- effective settings (so a site-level override of auto_sign_out_enabled/
-- _time works correctly), converts "now" to the site's own local time via
-- its timezone column (correctly DST-aware via Postgres's AT TIME ZONE,
-- not manual offset math), and only proceeds once local time has reached
-- the configured time AND no run is already recorded for that site today.
-- Called for every active site on a frequent cron tick (see cron-worker) —
-- the run-tracking table is what prevents it firing more than once a day
-- per site regardless of how often the endpoint is hit.

CREATE TABLE public.presence_fire_safety_auto_sign_out_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  signed_out_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, site_id, run_date)
);
ALTER TABLE public.presence_fire_safety_auto_sign_out_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY pfs_auto_sign_out_runs_select ON public.presence_fire_safety_auto_sign_out_runs
  FOR SELECT USING (company_id IN (
    SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION public.presence_fire_safety_run_auto_sign_out(p_site_id uuid)
RETURNS integer  -- >=0 = number signed out; -1 = already ran today; -2 = not enabled/not due
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_site public.sites;
  v_company_id uuid;
  v_settings public.presence_fire_safety_settings;
  v_local_date date;
  v_local_time time;
  v_run_id uuid;
  v_row record;
  v_event_id uuid;
  v_count integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'presence_fire_safety_run_auto_sign_out is for the automated cron job only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_site FROM public.sites WHERE id = p_site_id;
  IF v_site.id IS NULL THEN RETURN -2; END IF;
  v_company_id := v_site.company_id;

  SELECT * INTO v_settings FROM public.presence_fire_safety_effective_settings(v_company_id, p_site_id);
  IF NOT COALESCE(v_settings.auto_sign_out_enabled, false) OR v_settings.auto_sign_out_time IS NULL THEN
    RETURN -2;
  END IF;

  v_local_date := (now() AT TIME ZONE COALESCE(v_site.timezone, 'UTC'))::date;
  v_local_time := (now() AT TIME ZONE COALESCE(v_site.timezone, 'UTC'))::time;
  IF v_local_time < v_settings.auto_sign_out_time THEN
    RETURN -2;
  END IF;

  INSERT INTO public.presence_fire_safety_auto_sign_out_runs (company_id, site_id, run_date, signed_out_count)
  VALUES (v_company_id, p_site_id, v_local_date, 0)
  ON CONFLICT (company_id, site_id, run_date) DO NOTHING
  RETURNING id INTO v_run_id;
  IF v_run_id IS NULL THEN RETURN -1; END IF;

  FOR v_row IN
    SELECT * FROM public.presence_fire_safety_current_presence
    WHERE company_id = v_company_id AND site_id = p_site_id AND current_status = 'in'
  LOOP
    INSERT INTO public.presence_fire_safety_events (
      company_id, site_id, subject_type, employee_id, visitor_visit_id, contractor_visit_id,
      direction, method, notes
    ) VALUES (
      v_company_id, p_site_id, v_row.subject_type, v_row.employee_id, v_row.visitor_visit_id, v_row.contractor_visit_id,
      'out', 'automatic', 'Automatic end-of-day sign-out'
    ) RETURNING id INTO v_event_id;

    UPDATE public.presence_fire_safety_current_presence
    SET current_status = 'out', last_event_id = v_event_id, last_seen_at = now(), updated_at = now()
    WHERE id = v_row.id;

    IF v_row.subject_type = 'visitor' THEN
      UPDATE public.presence_fire_safety_visitor_visits SET status = 'signed_out', signed_out_at = now() WHERE id = v_row.visitor_visit_id;
    ELSIF v_row.subject_type = 'contractor' THEN
      UPDATE public.presence_fire_safety_contractor_visits SET status = 'signed_out', signed_out_at = now() WHERE id = v_row.contractor_visit_id;
    END IF;

    INSERT INTO public.presence_fire_safety_audit_logs (company_id, site_id, action, entity_type, entity_id, new_values)
    VALUES (v_company_id, p_site_id, 'presence_event_recorded', v_row.subject_type,
      COALESCE(v_row.employee_id, v_row.visitor_visit_id, v_row.contractor_visit_id),
      jsonb_build_object('direction', 'out', 'method', 'automatic', 'event_id', v_event_id));

    v_count := v_count + 1;
  END LOOP;

  UPDATE public.presence_fire_safety_auto_sign_out_runs SET signed_out_count = v_count WHERE id = v_run_id;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_run_auto_sign_out(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_run_auto_sign_out(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_effective_settings(uuid, uuid) TO service_role;
