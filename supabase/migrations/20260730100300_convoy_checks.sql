-- ============================================================================
-- SmartCore Convoy — Migration 4: Vehicle checks (driver walkarounds)
-- GPS is captured at start/finish, and every required zone item is backed by
-- a live-camera photo (see convoy_check_photos), each independently GPS- and
-- time-stamped. integrity_flags records anything that looks off — off-site,
-- low GPS accuracy, completed suspiciously fast, or photos whose locations
-- don't cluster together — surfaced to fleet managers rather than silently
-- trusted or silently blocked (browsers can't force location/liveness).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.convoy_vehicle_checks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  vehicle_id            uuid NOT NULL REFERENCES public.convoy_vehicles(id) ON DELETE CASCADE,
  driver_employee_id    uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  template_id           uuid REFERENCES public.convoy_checklist_templates(id) ON DELETE SET NULL,
  check_type            text NOT NULL DEFAULT 'pre_use' CHECK (check_type IN ('pre_use','return','ad_hoc')),
  status                text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted')),
  overall_result        text CHECK (overall_result IN ('pass','defect')),
  mileage               integer,

  started_at            timestamptz NOT NULL DEFAULT now(),
  submitted_at          timestamptz,
  duration_seconds      integer,

  start_latitude        numeric(9,6),
  start_longitude       numeric(9,6),
  start_accuracy_m      numeric,
  end_latitude          numeric(9,6),
  end_longitude         numeric(9,6),
  end_accuracy_m        numeric,
  distance_from_depot_m numeric,

  integrity_flags       jsonb NOT NULL DEFAULT '[]'::jsonb,

  driver_attestation    boolean NOT NULL DEFAULT false,
  driver_attested_name  text,

  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS convoy_vehicle_checks_company_idx ON public.convoy_vehicle_checks(company_id, started_at DESC);
CREATE INDEX IF NOT EXISTS convoy_vehicle_checks_vehicle_idx ON public.convoy_vehicle_checks(vehicle_id, started_at DESC);
CREATE INDEX IF NOT EXISTS convoy_vehicle_checks_driver_idx ON public.convoy_vehicle_checks(driver_employee_id);

CREATE TABLE IF NOT EXISTS public.convoy_check_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id      uuid NOT NULL REFERENCES public.convoy_vehicle_checks(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  latitude      numeric(9,6),
  longitude     numeric(9,6),
  accuracy_m    numeric,
  captured_at   timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.core_employees(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS convoy_check_photos_check_idx ON public.convoy_check_photos(check_id);

CREATE TABLE IF NOT EXISTS public.convoy_check_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id      uuid NOT NULL REFERENCES public.convoy_vehicle_checks(id) ON DELETE CASCADE,
  label         text NOT NULL,
  zone          text NOT NULL DEFAULT 'general',
  sort_order    integer NOT NULL DEFAULT 0,
  requires_photo boolean NOT NULL DEFAULT true,
  passed        boolean,
  notes         text,
  photo_id      uuid REFERENCES public.convoy_check_photos(id) ON DELETE SET NULL,
  completed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS convoy_check_items_check_idx ON public.convoy_check_items(check_id, sort_order);

-- ----------------------------------------------------------------------------
-- Immutability: once a check is submitted, it and its items/photos become an
-- audit record — no further edits, by anyone but a manager correcting a
-- clerical error. Mirrors the append-only convention used for audit_logs.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convoy_check_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'submitted' AND NOT public.convoy_has_permission(OLD.company_id, 'convoy.manage_vehicles') THEN
    RAISE EXCEPTION 'This check has been submitted and is now a locked audit record.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS convoy_check_guard_update_trg ON public.convoy_vehicle_checks;
CREATE TRIGGER convoy_check_guard_update_trg BEFORE UPDATE ON public.convoy_vehicle_checks
  FOR EACH ROW EXECUTE FUNCTION public.convoy_check_guard_update();

CREATE OR REPLACE FUNCTION public.convoy_check_item_guard_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_company_id uuid;
BEGIN
  SELECT status, company_id INTO v_status, v_company_id
  FROM public.convoy_vehicle_checks WHERE id = COALESCE(NEW.check_id, OLD.check_id);

  IF v_status = 'submitted' AND NOT public.convoy_has_permission(v_company_id, 'convoy.manage_vehicles') THEN
    RAISE EXCEPTION 'This check has been submitted and is now a locked audit record.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS convoy_check_item_guard_write_trg ON public.convoy_check_items;
CREATE TRIGGER convoy_check_item_guard_write_trg BEFORE UPDATE ON public.convoy_check_items
  FOR EACH ROW EXECUTE FUNCTION public.convoy_check_item_guard_write();

ALTER TABLE public.convoy_vehicle_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convoy_check_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convoy_check_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY convoy_vehicle_checks_select ON public.convoy_vehicle_checks
  FOR SELECT USING (public.convoy_has_permission(company_id, 'convoy.view_vehicles'));

CREATE POLICY convoy_vehicle_checks_insert ON public.convoy_vehicle_checks
  FOR INSERT WITH CHECK (
    public.convoy_has_permission(company_id, 'convoy.perform_checks')
    AND driver_employee_id = public.convoy_current_employee_id(company_id)
  );

CREATE POLICY convoy_vehicle_checks_update ON public.convoy_vehicle_checks
  FOR UPDATE USING (
    public.convoy_has_permission(company_id, 'convoy.view_vehicles')
    AND (driver_employee_id = public.convoy_current_employee_id(company_id)
         OR public.convoy_has_permission(company_id, 'convoy.manage_vehicles'))
  ) WITH CHECK (public.convoy_has_permission(company_id, 'convoy.view_vehicles'));

CREATE POLICY convoy_check_items_select ON public.convoy_check_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.convoy_vehicle_checks c
            WHERE c.id = check_id AND public.convoy_has_permission(c.company_id, 'convoy.view_vehicles'))
  );

CREATE POLICY convoy_check_items_write ON public.convoy_check_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.convoy_vehicle_checks c
            WHERE c.id = check_id
              AND (c.driver_employee_id = public.convoy_current_employee_id(c.company_id)
                   OR public.convoy_has_permission(c.company_id, 'convoy.manage_vehicles')))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.convoy_vehicle_checks c
            WHERE c.id = check_id
              AND (c.driver_employee_id = public.convoy_current_employee_id(c.company_id)
                   OR public.convoy_has_permission(c.company_id, 'convoy.manage_vehicles')))
  );

CREATE POLICY convoy_check_photos_select ON public.convoy_check_photos
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.convoy_vehicle_checks c
            WHERE c.id = check_id AND public.convoy_has_permission(c.company_id, 'convoy.view_vehicles'))
  );

CREATE POLICY convoy_check_photos_insert ON public.convoy_check_photos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.convoy_vehicle_checks c
            WHERE c.id = check_id AND c.status = 'in_progress'
              AND c.driver_employee_id = public.convoy_current_employee_id(c.company_id))
  );

-- ----------------------------------------------------------------------------
-- Submission: computes duration, depot distance and integrity flags
-- server-side (never trusting a client-computed verdict), locks the record,
-- and hands back failed items so the caller can raise defects for them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convoy_submit_check(
  p_check_id uuid,
  p_end_latitude numeric,
  p_end_longitude numeric,
  p_end_accuracy_m numeric,
  p_driver_attested_name text
) RETURNS public.convoy_vehicle_checks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_check public.convoy_vehicle_checks;
  v_vehicle public.convoy_vehicles;
  v_settings public.convoy_settings;
  v_flags jsonb := '[]'::jsonb;
  v_duration integer;
  v_start_dist numeric;
  v_end_dist numeric;
  v_photo_spread numeric;
  v_incomplete_count integer;
BEGIN
  SELECT * INTO v_check FROM public.convoy_vehicle_checks WHERE id = p_check_id FOR UPDATE;
  IF v_check IS NULL THEN RAISE EXCEPTION 'Check not found'; END IF;
  IF v_check.status = 'submitted' THEN RAISE EXCEPTION 'Check already submitted'; END IF;
  IF v_check.driver_employee_id <> public.convoy_current_employee_id(v_check.company_id) THEN
    RAISE EXCEPTION 'Only the driver who started this check can submit it';
  END IF;

  SELECT count(*) INTO v_incomplete_count FROM public.convoy_check_items
  WHERE check_id = p_check_id
    AND (passed IS NULL OR (requires_photo AND photo_id IS NULL));
  IF v_incomplete_count > 0 THEN
    RAISE EXCEPTION 'Every checklist item must be completed (and photographed where required) before submitting.';
  END IF;
  IF p_driver_attested_name IS NULL OR trim(p_driver_attested_name) = '' THEN
    RAISE EXCEPTION 'Driver attestation name is required to submit a check.';
  END IF;

  SELECT * INTO v_vehicle FROM public.convoy_vehicles WHERE id = v_check.vehicle_id;
  SELECT * INTO v_settings FROM public.convoy_settings WHERE company_id = v_check.company_id;
  IF v_settings IS NULL THEN
    INSERT INTO public.convoy_settings (company_id) VALUES (v_check.company_id)
    ON CONFLICT (company_id) DO NOTHING
    RETURNING * INTO v_settings;
    IF v_settings IS NULL THEN SELECT * INTO v_settings FROM public.convoy_settings WHERE company_id = v_check.company_id; END IF;
  END IF;

  v_duration := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_check.started_at))::integer);

  IF v_duration < v_settings.min_walkaround_seconds THEN
    v_flags := v_flags || '["too_fast"]'::jsonb;
  END IF;

  IF v_check.start_accuracy_m IS NOT NULL AND v_check.start_accuracy_m > v_settings.gps_accuracy_warn_m THEN
    v_flags := v_flags || '["low_accuracy_start"]'::jsonb;
  END IF;
  IF p_end_accuracy_m IS NOT NULL AND p_end_accuracy_m > v_settings.gps_accuracy_warn_m THEN
    v_flags := v_flags || '["low_accuracy_end"]'::jsonb;
  END IF;
  IF v_check.start_latitude IS NULL THEN
    v_flags := v_flags || '["location_unavailable"]'::jsonb;
  END IF;

  IF v_vehicle.depot_latitude IS NOT NULL AND v_check.start_latitude IS NOT NULL THEN
    v_start_dist := public.convoy_distance_metres(v_check.start_latitude, v_check.start_longitude, v_vehicle.depot_latitude, v_vehicle.depot_longitude);
    IF v_start_dist > COALESCE(v_vehicle.geofence_radius_m, v_settings.default_geofence_radius_m) THEN
      v_flags := v_flags || '["off_site"]'::jsonb;
    END IF;
  END IF;

  IF v_vehicle.depot_latitude IS NOT NULL AND p_end_latitude IS NOT NULL THEN
    v_end_dist := public.convoy_distance_metres(p_end_latitude, p_end_longitude, v_vehicle.depot_latitude, v_vehicle.depot_longitude);
  END IF;

  -- Every zone photo taken during the same walkaround should cluster near
  -- the vehicle — a wild outlier suggests a stale or borrowed photo.
  SELECT max(public.convoy_distance_metres(p1.latitude, p1.longitude, p2.latitude, p2.longitude))
  INTO v_photo_spread
  FROM public.convoy_check_photos p1, public.convoy_check_photos p2
  WHERE p1.check_id = p_check_id AND p2.check_id = p_check_id
    AND p1.latitude IS NOT NULL AND p2.latitude IS NOT NULL;
  IF v_photo_spread IS NOT NULL AND v_photo_spread > 250 THEN
    v_flags := v_flags || '["photo_locations_inconsistent"]'::jsonb;
  END IF;

  UPDATE public.convoy_vehicle_checks SET
    status = 'submitted',
    submitted_at = now(),
    duration_seconds = v_duration,
    end_latitude = p_end_latitude,
    end_longitude = p_end_longitude,
    end_accuracy_m = p_end_accuracy_m,
    distance_from_depot_m = COALESCE(v_end_dist, v_start_dist),
    integrity_flags = v_flags,
    driver_attestation = true,
    driver_attested_name = p_driver_attested_name,
    overall_result = CASE WHEN EXISTS (SELECT 1 FROM public.convoy_check_items WHERE check_id = p_check_id AND passed = false) THEN 'defect' ELSE 'pass' END
  WHERE id = p_check_id
  RETURNING * INTO v_check;

  RETURN v_check;
END;
$$;

REVOKE ALL ON FUNCTION public.convoy_submit_check(uuid, numeric, numeric, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convoy_submit_check(uuid, numeric, numeric, numeric, text) TO authenticated;
