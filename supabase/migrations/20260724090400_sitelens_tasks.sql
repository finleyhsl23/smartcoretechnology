-- ============================================================================
-- SmartCore SiteLens — Migration 5: Tasks
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sitelens_tasks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES public.sitelens_projects(id) ON DELETE CASCADE,
  company_id           uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  title                text NOT NULL,
  description          text,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done')),
  priority             text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  assignee_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  due_date             date,
  created_by           uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz
);
CREATE INDEX IF NOT EXISTS sitelens_tasks_project_idx ON public.sitelens_tasks(project_id);
CREATE INDEX IF NOT EXISTS sitelens_tasks_assignee_idx ON public.sitelens_tasks(assignee_employee_id, status);
CREATE INDEX IF NOT EXISTS sitelens_tasks_company_idx ON public.sitelens_tasks(company_id, status);

-- RLS alone can't restrict *which columns* an UPDATE touches — a caller who
-- only qualifies as "the assignee" (no manage_tasks permission) must be
-- limited to moving the task's status, not silently rewriting its title,
-- assignee or due date via a raw API call. This trigger is that column-level
-- guard; the checkbox toggle in the UI only ever sends {status}, so this
-- never affects legitimate use.
CREATE OR REPLACE FUNCTION public.sitelens_tasks_track_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.sitelens_has_permission(NEW.company_id, 'sitelens.manage_tasks') THEN
    IF NEW.title IS DISTINCT FROM OLD.title
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.priority IS DISTINCT FROM OLD.priority
      OR NEW.assignee_employee_id IS DISTINCT FROM OLD.assignee_employee_id
      OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
    THEN
      RAISE EXCEPTION 'Only the task assignee''s status can be changed without sitelens.manage_tasks permission.';
    END IF;
  END IF;

  NEW.updated_at = now();
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    NEW.completed_at = now();
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sitelens_tasks_set_updated_at ON public.sitelens_tasks;
CREATE TRIGGER sitelens_tasks_set_updated_at BEFORE UPDATE ON public.sitelens_tasks
  FOR EACH ROW EXECUTE FUNCTION public.sitelens_tasks_track_completion();

ALTER TABLE public.sitelens_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitelens_tasks_select ON public.sitelens_tasks
  FOR SELECT USING (
    public.sitelens_has_permission(company_id, 'sitelens.view_projects')
    AND public.sitelens_can_access_project(project_id)
  );

CREATE POLICY sitelens_tasks_insert ON public.sitelens_tasks
  FOR INSERT WITH CHECK (
    public.sitelens_has_permission(company_id, 'sitelens.manage_tasks')
    AND public.sitelens_can_access_project(project_id)
  );

-- Anyone who can see a task may update it if it's assigned to them (so crew
-- can move their own tasks along); full editing (title/assignee/etc.) beyond
-- that requires manage_tasks.
CREATE POLICY sitelens_tasks_update ON public.sitelens_tasks
  FOR UPDATE USING (
    public.sitelens_can_access_project(project_id)
    AND (
      assignee_employee_id = public.sitelens_current_employee_id(company_id)
      OR public.sitelens_has_permission(company_id, 'sitelens.manage_tasks')
    )
  ) WITH CHECK (
    public.sitelens_can_access_project(project_id)
  );

CREATE POLICY sitelens_tasks_delete ON public.sitelens_tasks
  FOR DELETE USING (public.sitelens_has_permission(company_id, 'sitelens.manage_tasks'));
