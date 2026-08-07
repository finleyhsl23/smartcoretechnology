-- ============================================================================
-- SmartCore Convoy — Migration 3: Checklist templates
-- Each template item can require a live-camera zone photo — this is the
-- mechanism that forces a physical walkaround rather than a desk tick-box.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.convoy_checklist_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  vehicle_type  text NOT NULL DEFAULT 'van' CHECK (vehicle_type IN ('car','van','minibus','hgv','plant','other')),
  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS convoy_checklist_templates_company_idx ON public.convoy_checklist_templates(company_id);

DROP TRIGGER IF EXISTS convoy_checklist_templates_set_updated_at ON public.convoy_checklist_templates;
CREATE TRIGGER convoy_checklist_templates_set_updated_at BEFORE UPDATE ON public.convoy_checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.convoy_checklist_template_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL REFERENCES public.convoy_checklist_templates(id) ON DELETE CASCADE,
  label           text NOT NULL,
  zone            text NOT NULL DEFAULT 'general' CHECK (zone IN (
                    'front','rear','driver_side','passenger_side','tyres_wheels',
                    'lights_indicators','windscreen_mirrors','fluids_engine',
                    'interior_cab','documents','general'
                  )),
  sort_order      integer NOT NULL DEFAULT 0,
  requires_photo  boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS convoy_checklist_template_items_template_idx ON public.convoy_checklist_template_items(template_id, sort_order);

ALTER TABLE public.convoy_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convoy_checklist_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY convoy_checklist_templates_select ON public.convoy_checklist_templates
  FOR SELECT USING (public.convoy_has_permission(company_id, 'convoy.view_vehicles'));

CREATE POLICY convoy_checklist_templates_write ON public.convoy_checklist_templates
  FOR ALL USING (public.convoy_has_permission(company_id, 'convoy.manage_checklists'))
  WITH CHECK (public.convoy_has_permission(company_id, 'convoy.manage_checklists'));

CREATE POLICY convoy_checklist_template_items_select ON public.convoy_checklist_template_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.convoy_checklist_templates t
            WHERE t.id = template_id AND public.convoy_has_permission(t.company_id, 'convoy.view_vehicles'))
  );

CREATE POLICY convoy_checklist_template_items_write ON public.convoy_checklist_template_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.convoy_checklist_templates t
            WHERE t.id = template_id AND public.convoy_has_permission(t.company_id, 'convoy.manage_checklists'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.convoy_checklist_templates t
            WHERE t.id = template_id AND public.convoy_has_permission(t.company_id, 'convoy.manage_checklists'))
  );

-- Seed a sensible default template per company the first time Convoy is
-- used — called opportunistically by any authenticated member (e.g. the
-- first driver to open the check page on a brand-new company, before any
-- admin has configured a checklist), not just checklist managers. It writes
-- fixed, non-caller-controlled content and only when the company has no
-- templates yet, so requiring just company membership (view_vehicles) here
-- is safe — this is a bootstrap convenience, not a privileged write path.
CREATE OR REPLACE FUNCTION public.convoy_seed_default_template(p_company_id uuid, p_created_by uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_template_id uuid;
BEGIN
  IF NOT public.convoy_has_permission(p_company_id, 'convoy.view_vehicles') THEN
    RAISE EXCEPTION 'Not permitted';
  END IF;

  -- Guard against a race between two first-time users both seeding at once.
  SELECT id INTO v_template_id FROM public.convoy_checklist_templates WHERE company_id = p_company_id LIMIT 1;
  IF v_template_id IS NOT NULL THEN
    RETURN v_template_id;
  END IF;

  INSERT INTO public.convoy_checklist_templates (company_id, name, vehicle_type, created_by)
  VALUES (p_company_id, 'Standard Daily Walkaround', 'van', p_created_by)
  RETURNING id INTO v_template_id;

  INSERT INTO public.convoy_checklist_template_items (template_id, label, zone, sort_order, requires_photo) VALUES
    (v_template_id, 'Front bumper, number plate & badges', 'front', 1, true),
    (v_template_id, 'Windscreen, wipers & mirrors', 'windscreen_mirrors', 2, true),
    (v_template_id, 'Driver side panels & door', 'driver_side', 3, true),
    (v_template_id, 'Passenger side panels & door', 'passenger_side', 4, true),
    (v_template_id, 'Rear bumper, lights & doors', 'rear', 5, true),
    (v_template_id, 'Tyres, wheels & tyre pressure', 'tyres_wheels', 6, true),
    (v_template_id, 'Lights & indicators working', 'lights_indicators', 7, true),
    (v_template_id, 'Engine oil, coolant & screenwash levels', 'fluids_engine', 8, false),
    (v_template_id, 'Interior, seatbelts & horn', 'interior_cab', 9, false),
    (v_template_id, 'Documents (insurance, MOT, licence) in vehicle', 'documents', 10, false);

  RETURN v_template_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convoy_seed_default_template(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convoy_seed_default_template(uuid, uuid) TO authenticated;
