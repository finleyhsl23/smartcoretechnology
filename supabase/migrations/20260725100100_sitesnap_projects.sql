-- ============================================================================
-- SmartCore SiteSnap — Migration 2: Projects, project team access, tags
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sitesnap_projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  name             text NOT NULL,
  client_name      text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  address_line_1   text,
  address_line_2   text,
  city             text,
  county           text,
  postcode         text,
  country          text DEFAULT 'United Kingdom',
  latitude         numeric(9,6),
  longitude        numeric(9,6),
  description      text,
  created_by       uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  updated_by       uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);
CREATE INDEX IF NOT EXISTS sitesnap_projects_company_idx ON public.sitesnap_projects(company_id, status);

DROP TRIGGER IF EXISTS sitesnap_projects_set_updated_at ON public.sitesnap_projects;
CREATE TRIGGER sitesnap_projects_set_updated_at BEFORE UPDATE ON public.sitesnap_projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Project team access. Presence of ANY row for a project restricts visibility
-- to the listed members. A project with zero rows here is unrestricted (all
-- of the company's SiteSnap users can see it) — mirrors public.site_access
-- from Presence & Fire Safety, so small teams work with zero setup while
-- larger companies can scope crews to specific projects.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitesnap_project_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.sitesnap_projects(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  project_role text NOT NULL DEFAULT 'member' CHECK (project_role IN ('lead', 'member')),
  added_by    uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, employee_id)
);
CREATE INDEX IF NOT EXISTS sitesnap_project_members_project_idx ON public.sitesnap_project_members(project_id);
CREATE INDEX IF NOT EXISTS sitesnap_project_members_employee_idx ON public.sitesnap_project_members(employee_id);

CREATE OR REPLACE FUNCTION public.sitesnap_can_access_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sitesnap_projects p
    JOIN public.core_employees ce ON ce.company_id = p.company_id
    WHERE p.id = p_project_id
      AND ce.auth_user_id = auth.uid()
      AND (
        ce.role IN ('owner', 'admin', 'administrator')
        OR NOT EXISTS (SELECT 1 FROM public.sitesnap_project_members m WHERE m.project_id = p.id)
        OR EXISTS (SELECT 1 FROM public.sitesnap_project_members m WHERE m.project_id = p.id AND m.employee_id = ce.id)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.sitesnap_can_access_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sitesnap_can_access_project(uuid) TO authenticated;

ALTER TABLE public.sitesnap_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sitesnap_project_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitesnap_projects_select ON public.sitesnap_projects
  FOR SELECT USING (
    public.sitesnap_has_permission(company_id, 'sitesnap.view_projects')
    AND public.sitesnap_can_access_project(id)
  );

CREATE POLICY sitesnap_projects_write ON public.sitesnap_projects
  FOR ALL USING (
    public.sitesnap_has_permission(company_id, 'sitesnap.manage_projects')
  ) WITH CHECK (
    public.sitesnap_has_permission(company_id, 'sitesnap.manage_projects')
  );

CREATE POLICY sitesnap_project_members_select ON public.sitesnap_project_members
  FOR SELECT USING (
    public.sitesnap_has_permission(company_id, 'sitesnap.view_projects')
    AND public.sitesnap_can_access_project(project_id)
  );

CREATE POLICY sitesnap_project_members_write ON public.sitesnap_project_members
  FOR ALL USING (
    public.sitesnap_has_permission(company_id, 'sitesnap.manage_projects')
    OR public.sitesnap_has_permission(company_id, 'sitesnap.manage_team')
  ) WITH CHECK (
    public.sitesnap_has_permission(company_id, 'sitesnap.manage_projects')
    OR public.sitesnap_has_permission(company_id, 'sitesnap.manage_team')
  );

-- ----------------------------------------------------------------------------
-- Tags — company-level catalog, applied to media (see migration 3).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitesnap_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#1e5cff',
  created_by  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, name)
);
CREATE INDEX IF NOT EXISTS sitesnap_tags_company_idx ON public.sitesnap_tags(company_id);

ALTER TABLE public.sitesnap_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitesnap_tags_select ON public.sitesnap_tags
  FOR SELECT USING (public.sitesnap_has_permission(company_id, 'sitesnap.view_projects'));

CREATE POLICY sitesnap_tags_write ON public.sitesnap_tags
  FOR ALL USING (public.sitesnap_has_permission(company_id, 'sitesnap.capture_media'))
  WITH CHECK (public.sitesnap_has_permission(company_id, 'sitesnap.capture_media'));
