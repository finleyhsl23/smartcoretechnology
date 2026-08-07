-- ============================================================================
-- SmartCore Convoy — Migration 5: Defects
-- Auto-raised from failed checklist items on submit, or reported manually.
-- An 'off_road' severity defect immediately takes the vehicle VOR.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.convoy_defects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  vehicle_id          uuid NOT NULL REFERENCES public.convoy_vehicles(id) ON DELETE CASCADE,
  source_check_id     uuid REFERENCES public.convoy_vehicle_checks(id) ON DELETE SET NULL,
  source_check_item_id uuid REFERENCES public.convoy_check_items(id) ON DELETE SET NULL,
  title               text NOT NULL,
  description         text,
  severity            text NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor','major','off_road')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  reported_by         uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  assigned_to         uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  resolved_by         uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  resolved_at         timestamptz,
  resolution_notes    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS convoy_defects_company_idx ON public.convoy_defects(company_id, status);
CREATE INDEX IF NOT EXISTS convoy_defects_vehicle_idx ON public.convoy_defects(vehicle_id);

DROP TRIGGER IF EXISTS convoy_defects_set_updated_at ON public.convoy_defects;
CREATE TRIGGER convoy_defects_set_updated_at BEFORE UPDATE ON public.convoy_defects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.convoy_defect_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id     uuid NOT NULL REFERENCES public.convoy_defects(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  latitude      numeric(9,6),
  longitude     numeric(9,6),
  created_by    uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS convoy_defect_photos_defect_idx ON public.convoy_defect_photos(defect_id);

CREATE TABLE IF NOT EXISTS public.convoy_defect_comments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  defect_id          uuid NOT NULL REFERENCES public.convoy_defects(id) ON DELETE CASCADE,
  author_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  body               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS convoy_defect_comments_defect_idx ON public.convoy_defect_comments(defect_id, created_at);

-- A newly created (or re-opened) off_road defect takes the vehicle out of
-- service immediately — fleet managers should not have to notice a defect
-- row to know a vehicle is unsafe to drive.
CREATE OR REPLACE FUNCTION public.convoy_defect_vor_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.severity = 'off_road' AND NEW.status <> 'resolved' THEN
    UPDATE public.convoy_vehicles SET status = 'vor' WHERE id = NEW.vehicle_id AND status <> 'retired';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS convoy_defect_vor_sync_trg ON public.convoy_defects;
CREATE TRIGGER convoy_defect_vor_sync_trg AFTER INSERT OR UPDATE ON public.convoy_defects
  FOR EACH ROW EXECUTE FUNCTION public.convoy_defect_vor_sync();

ALTER TABLE public.convoy_defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convoy_defect_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convoy_defect_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY convoy_defects_select ON public.convoy_defects
  FOR SELECT USING (public.convoy_has_permission(company_id, 'convoy.view_vehicles'));

CREATE POLICY convoy_defects_insert ON public.convoy_defects
  FOR INSERT WITH CHECK (public.convoy_has_permission(company_id, 'convoy.perform_checks'));

CREATE POLICY convoy_defects_update ON public.convoy_defects
  FOR UPDATE USING (public.convoy_has_permission(company_id, 'convoy.manage_defects'))
  WITH CHECK (public.convoy_has_permission(company_id, 'convoy.manage_defects'));

CREATE POLICY convoy_defect_photos_select ON public.convoy_defect_photos
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.convoy_defects d
            WHERE d.id = defect_id AND public.convoy_has_permission(d.company_id, 'convoy.view_vehicles'))
  );

CREATE POLICY convoy_defect_photos_insert ON public.convoy_defect_photos
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.convoy_defects d
            WHERE d.id = defect_id AND public.convoy_has_permission(d.company_id, 'convoy.perform_checks'))
  );

CREATE POLICY convoy_defect_comments_select ON public.convoy_defect_comments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.convoy_defects d
            WHERE d.id = defect_id AND public.convoy_has_permission(d.company_id, 'convoy.view_vehicles'))
  );

CREATE POLICY convoy_defect_comments_insert ON public.convoy_defect_comments
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.convoy_defects d
            WHERE d.id = defect_id AND public.convoy_has_permission(d.company_id, 'convoy.view_vehicles'))
  );

-- ----------------------------------------------------------------------------
-- Auto-raise a defect per failed checklist item when a check is submitted.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convoy_check_submit_raise_defects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item record;
BEGIN
  IF NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted' THEN
    FOR v_item IN SELECT * FROM public.convoy_check_items WHERE check_id = NEW.id AND passed = false LOOP
      INSERT INTO public.convoy_defects (
        company_id, vehicle_id, source_check_id, source_check_item_id,
        title, description, severity, reported_by
      ) VALUES (
        NEW.company_id, NEW.vehicle_id, NEW.id, v_item.id,
        v_item.label, v_item.notes, 'minor', NEW.driver_employee_id
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS convoy_check_submit_raise_defects_trg ON public.convoy_vehicle_checks;
CREATE TRIGGER convoy_check_submit_raise_defects_trg AFTER UPDATE ON public.convoy_vehicle_checks
  FOR EACH ROW EXECUTE FUNCTION public.convoy_check_submit_raise_defects();
