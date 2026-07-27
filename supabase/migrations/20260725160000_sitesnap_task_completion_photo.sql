-- ============================================================================
-- SmartCore SiteSnap — Require a photo before a task can be marked done.
-- Links sitesnap_media to the task it's proof for (nullable — ordinary
-- project photos aren't attached to any task), and the completion trigger
-- now refuses the 'done' transition unless at least one photo already
-- references the task. The client uploads the proof photo (with task_id
-- set) before flipping status, so by the time this trigger runs the row
-- already exists — this is the server-side backstop, not just client UX.
-- ============================================================================

ALTER TABLE public.sitesnap_media
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.sitesnap_tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sitesnap_media_task_idx ON public.sitesnap_media(task_id) WHERE task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sitesnap_tasks_track_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.sitesnap_has_permission(NEW.company_id, 'sitesnap.manage_tasks') THEN
    IF NEW.title IS DISTINCT FROM OLD.title
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.priority IS DISTINCT FROM OLD.priority
      OR NEW.assignee_employee_id IS DISTINCT FROM OLD.assignee_employee_id
      OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
    THEN
      RAISE EXCEPTION 'Only the task assignee''s status can be changed without sitesnap.manage_tasks permission.';
    END IF;
  END IF;

  NEW.updated_at = now();
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    IF NOT EXISTS (SELECT 1 FROM public.sitesnap_media m WHERE m.task_id = NEW.id) THEN
      RAISE EXCEPTION 'Attach a photo before marking this task done.';
    END IF;
    NEW.completed_at = now();
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$;
