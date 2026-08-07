-- ============================================================================
-- SmartCore SiteSnap — Floor plans. Company-toggleable (Settings), assigned
-- to a project, with multiple levels each holding wall/door/window/room
-- elements. Owners/admins can edit; everyone else with project access can
-- only view. Tasks can optionally be pinned to a room (sitesnap_tasks.
-- room_element_id) so a floor plan can show per-room completion.
--
-- Company_id/project_id are denormalized onto levels and elements (not just
-- floor_plans) — matches the flat-columns-for-simple-RLS convention already
-- used everywhere else in this module (media, tasks, shifts all do this)
-- rather than requiring RLS policies to join up through two parent tables.
-- ============================================================================

ALTER TABLE public.sitesnap_settings
  ADD COLUMN IF NOT EXISTS floor_plans_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.sitesnap_floor_plans (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  project_id           uuid NOT NULL REFERENCES public.sitesnap_projects(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  created_by           uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  updated_by           uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sitesnap_floor_plans_project_idx ON public.sitesnap_floor_plans(project_id);

DROP TRIGGER IF EXISTS sitesnap_floor_plans_set_updated_at ON public.sitesnap_floor_plans;
CREATE TRIGGER sitesnap_floor_plans_set_updated_at BEFORE UPDATE ON public.sitesnap_floor_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.sitesnap_floor_plan_levels (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_plan_id      uuid NOT NULL REFERENCES public.sitesnap_floor_plans(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  project_id         uuid NOT NULL REFERENCES public.sitesnap_projects(id) ON DELETE CASCADE,
  name               text NOT NULL,
  sort_order         integer NOT NULL DEFAULT 0,
  pixels_per_meter   numeric(8,2) NOT NULL DEFAULT 50,
  reference_image_path text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sitesnap_floor_plan_levels_plan_idx ON public.sitesnap_floor_plan_levels(floor_plan_id, sort_order);

CREATE TABLE IF NOT EXISTS public.sitesnap_floor_plan_elements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id      uuid NOT NULL REFERENCES public.sitesnap_floor_plan_levels(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES public.sitesnap_projects(id) ON DELETE CASCADE,
  element_type  text NOT NULL CHECK (element_type IN ('wall', 'door', 'window', 'room')),
  -- wall/door/window: {x1,y1,x2,y2}. room: {x,y,width,height}. All in level pixel-space.
  geometry      jsonb NOT NULL,
  label         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sitesnap_floor_plan_elements_level_idx ON public.sitesnap_floor_plan_elements(level_id);

ALTER TABLE public.sitesnap_tasks
  ADD COLUMN IF NOT EXISTS room_element_id uuid REFERENCES public.sitesnap_floor_plan_elements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sitesnap_tasks_room_idx ON public.sitesnap_tasks(room_element_id) WHERE room_element_id IS NOT NULL;

ALTER TABLE public.sitesnap_floor_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sitesnap_floor_plan_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sitesnap_floor_plan_elements ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitesnap_floor_plans_select ON public.sitesnap_floor_plans
  FOR SELECT USING (
    public.sitesnap_has_permission(company_id, 'sitesnap.view_projects')
    AND public.sitesnap_can_access_project(project_id)
  );
CREATE POLICY sitesnap_floor_plans_write ON public.sitesnap_floor_plans
  FOR ALL USING (public.sitesnap_is_admin(company_id) AND public.sitesnap_can_access_project(project_id))
  WITH CHECK (public.sitesnap_is_admin(company_id) AND public.sitesnap_can_access_project(project_id));

CREATE POLICY sitesnap_floor_plan_levels_select ON public.sitesnap_floor_plan_levels
  FOR SELECT USING (
    public.sitesnap_has_permission(company_id, 'sitesnap.view_projects')
    AND public.sitesnap_can_access_project(project_id)
  );
CREATE POLICY sitesnap_floor_plan_levels_write ON public.sitesnap_floor_plan_levels
  FOR ALL USING (public.sitesnap_is_admin(company_id) AND public.sitesnap_can_access_project(project_id))
  WITH CHECK (public.sitesnap_is_admin(company_id) AND public.sitesnap_can_access_project(project_id));

CREATE POLICY sitesnap_floor_plan_elements_select ON public.sitesnap_floor_plan_elements
  FOR SELECT USING (
    public.sitesnap_has_permission(company_id, 'sitesnap.view_projects')
    AND public.sitesnap_can_access_project(project_id)
  );
CREATE POLICY sitesnap_floor_plan_elements_write ON public.sitesnap_floor_plan_elements
  FOR ALL USING (public.sitesnap_is_admin(company_id) AND public.sitesnap_can_access_project(project_id))
  WITH CHECK (public.sitesnap_is_admin(company_id) AND public.sitesnap_can_access_project(project_id));

-- ----------------------------------------------------------------------------
-- Storage — reference/sketch images uploaded per level, traced over in the
-- builder (not automatically vectorized — see client code for why).
-- Object path convention: <company_id>/<project_id>/<floor_plan_id>/<level_id>.<ext>
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sitesnap-floorplans', 'sitesnap-floorplans', false, 26214400, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY sitesnap_floorplans_storage_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'sitesnap-floorplans'
    AND public.sitesnap_has_permission((split_part(name, '/', 1))::uuid, 'sitesnap.view_projects')
    AND public.sitesnap_can_access_project((split_part(name, '/', 2))::uuid)
  );

CREATE POLICY sitesnap_floorplans_storage_write ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'sitesnap-floorplans'
    AND public.sitesnap_is_admin((split_part(name, '/', 1))::uuid)
    AND public.sitesnap_can_access_project((split_part(name, '/', 2))::uuid)
  );

CREATE POLICY sitesnap_floorplans_storage_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'sitesnap-floorplans'
    AND public.sitesnap_is_admin((split_part(name, '/', 1))::uuid)
    AND public.sitesnap_can_access_project((split_part(name, '/', 2))::uuid)
  );
