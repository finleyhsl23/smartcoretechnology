-- ============================================================================
-- SmartCore SiteSnap — Migration 4: Checklists (company templates + per-
-- project instances) and daily logs
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sitesnap_checklist_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sitesnap_checklist_templates_company_idx ON public.sitesnap_checklist_templates(company_id);

DROP TRIGGER IF EXISTS sitesnap_checklist_templates_set_updated_at ON public.sitesnap_checklist_templates;
CREATE TRIGGER sitesnap_checklist_templates_set_updated_at BEFORE UPDATE ON public.sitesnap_checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.sitesnap_checklist_template_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES public.sitesnap_checklist_templates(id) ON DELETE CASCADE,
  label         text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  requires_photo boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sitesnap_checklist_template_items_template_idx ON public.sitesnap_checklist_template_items(template_id, sort_order);

ALTER TABLE public.sitesnap_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sitesnap_checklist_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitesnap_checklist_templates_select ON public.sitesnap_checklist_templates
  FOR SELECT USING (public.sitesnap_has_permission(company_id, 'sitesnap.view_projects'));

CREATE POLICY sitesnap_checklist_templates_write ON public.sitesnap_checklist_templates
  FOR ALL USING (public.sitesnap_has_permission(company_id, 'sitesnap.manage_checklists'))
  WITH CHECK (public.sitesnap_has_permission(company_id, 'sitesnap.manage_checklists'));

CREATE POLICY sitesnap_checklist_template_items_select ON public.sitesnap_checklist_template_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.sitesnap_checklist_templates t
            WHERE t.id = template_id AND public.sitesnap_has_permission(t.company_id, 'sitesnap.view_projects'))
  );

CREATE POLICY sitesnap_checklist_template_items_write ON public.sitesnap_checklist_template_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.sitesnap_checklist_templates t
            WHERE t.id = template_id AND public.sitesnap_has_permission(t.company_id, 'sitesnap.manage_checklists'))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.sitesnap_checklist_templates t
            WHERE t.id = template_id AND public.sitesnap_has_permission(t.company_id, 'sitesnap.manage_checklists'))
  );

-- ----------------------------------------------------------------------------
-- Project checklists — a template copied onto a project so it can be ticked
-- off independently of later template edits.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitesnap_project_checklists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.sitesnap_projects(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  template_id  uuid REFERENCES public.sitesnap_checklist_templates(id) ON DELETE SET NULL,
  name         text NOT NULL,
  created_by   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS sitesnap_project_checklists_project_idx ON public.sitesnap_project_checklists(project_id);

CREATE TABLE IF NOT EXISTS public.sitesnap_project_checklist_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_checklist_id uuid NOT NULL REFERENCES public.sitesnap_project_checklists(id) ON DELETE CASCADE,
  label               text NOT NULL,
  sort_order          integer NOT NULL DEFAULT 0,
  requires_photo      boolean NOT NULL DEFAULT false,
  is_complete         boolean NOT NULL DEFAULT false,
  completed_by        uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  completed_at        timestamptz,
  media_id            uuid REFERENCES public.sitesnap_media(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS sitesnap_project_checklist_items_checklist_idx ON public.sitesnap_project_checklist_items(project_checklist_id, sort_order);

ALTER TABLE public.sitesnap_project_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sitesnap_project_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitesnap_project_checklists_select ON public.sitesnap_project_checklists
  FOR SELECT USING (
    public.sitesnap_has_permission(company_id, 'sitesnap.view_projects')
    AND public.sitesnap_can_access_project(project_id)
  );

CREATE POLICY sitesnap_project_checklists_write ON public.sitesnap_project_checklists
  FOR ALL USING (
    public.sitesnap_has_permission(company_id, 'sitesnap.manage_checklists')
    AND public.sitesnap_can_access_project(project_id)
  ) WITH CHECK (
    public.sitesnap_has_permission(company_id, 'sitesnap.manage_checklists')
    AND public.sitesnap_can_access_project(project_id)
  );

CREATE POLICY sitesnap_project_checklist_items_select ON public.sitesnap_project_checklist_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.sitesnap_project_checklists c
            WHERE c.id = project_checklist_id AND public.sitesnap_has_permission(c.company_id, 'sitesnap.view_projects')
              AND public.sitesnap_can_access_project(c.project_id))
  );

-- Ticking items off is deliberately allowed to anyone who can view the
-- project's checklists (the crew on-site, not just checklist managers) —
-- managing the checklist itself (name/items) requires manage_checklists.
CREATE POLICY sitesnap_project_checklist_items_tick ON public.sitesnap_project_checklist_items
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.sitesnap_project_checklists c
            WHERE c.id = project_checklist_id AND public.sitesnap_has_permission(c.company_id, 'sitesnap.view_projects')
              AND public.sitesnap_can_access_project(c.project_id))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.sitesnap_project_checklists c
            WHERE c.id = project_checklist_id AND public.sitesnap_has_permission(c.company_id, 'sitesnap.view_projects')
              AND public.sitesnap_can_access_project(c.project_id))
  );

CREATE POLICY sitesnap_project_checklist_items_manage ON public.sitesnap_project_checklist_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.sitesnap_project_checklists c
            WHERE c.id = project_checklist_id AND public.sitesnap_has_permission(c.company_id, 'sitesnap.manage_checklists')
              AND public.sitesnap_can_access_project(c.project_id))
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.sitesnap_project_checklists c
            WHERE c.id = project_checklist_id AND public.sitesnap_has_permission(c.company_id, 'sitesnap.manage_checklists')
              AND public.sitesnap_can_access_project(c.project_id))
  );

-- ----------------------------------------------------------------------------
-- Daily logs — one free-form entry per crew member per day per project.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitesnap_daily_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.sitesnap_projects(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  log_date    date NOT NULL DEFAULT current_date,
  weather     text,
  crew_count  integer,
  notes       text NOT NULL,
  created_by  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sitesnap_daily_logs_project_idx ON public.sitesnap_daily_logs(project_id, log_date DESC);

DROP TRIGGER IF EXISTS sitesnap_daily_logs_set_updated_at ON public.sitesnap_daily_logs;
CREATE TRIGGER sitesnap_daily_logs_set_updated_at BEFORE UPDATE ON public.sitesnap_daily_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sitesnap_daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitesnap_daily_logs_select ON public.sitesnap_daily_logs
  FOR SELECT USING (
    public.sitesnap_has_permission(company_id, 'sitesnap.view_projects')
    AND public.sitesnap_can_access_project(project_id)
  );

CREATE POLICY sitesnap_daily_logs_insert ON public.sitesnap_daily_logs
  FOR INSERT WITH CHECK (
    public.sitesnap_has_permission(company_id, 'sitesnap.capture_media')
    AND public.sitesnap_can_access_project(project_id)
  );

CREATE POLICY sitesnap_daily_logs_update_own ON public.sitesnap_daily_logs
  FOR UPDATE USING (
    public.sitesnap_can_access_project(project_id)
    AND (created_by = public.sitesnap_current_employee_id(company_id) OR public.sitesnap_has_permission(company_id, 'sitesnap.manage_projects'))
  ) WITH CHECK (
    public.sitesnap_can_access_project(project_id)
  );

CREATE POLICY sitesnap_daily_logs_delete ON public.sitesnap_daily_logs
  FOR DELETE USING (
    created_by = public.sitesnap_current_employee_id(company_id) OR public.sitesnap_has_permission(company_id, 'sitesnap.manage_projects')
  );
