-- ============================================================================
-- SmartCore SiteSnap — Track who completed a task, and let them undo it too
-- (alongside the assignee, the creator, or a task manager).
-- ============================================================================

ALTER TABLE public.sitesnap_tasks
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES public.core_employees(id) ON DELETE SET NULL;

-- Trigger already auto-manages completed_at on every status transition —
-- completed_by now follows the same pattern, set from the caller's own
-- identity rather than something the client (or this RPC) passes in.
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
    NEW.completed_by = public.sitesnap_current_employee_id(NEW.company_id);
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at = NULL;
    NEW.completed_by = NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sitesnap_reopen_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_id uuid;
  v_task public.sitesnap_tasks;
  v_paths text[];
BEGIN
  SELECT ce.id INTO v_employee_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid() LIMIT 1;
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found.';
  END IF;

  SELECT * INTO v_task FROM public.sitesnap_tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'Task not found.';
  END IF;
  IF NOT public.sitesnap_can_access_project(v_task.project_id) THEN
    RAISE EXCEPTION 'You do not have access to this task.';
  END IF;
  IF v_task.assignee_employee_id IS DISTINCT FROM v_employee_id
     AND v_task.created_by IS DISTINCT FROM v_employee_id
     AND v_task.completed_by IS DISTINCT FROM v_employee_id
     AND NOT public.sitesnap_has_permission(v_task.company_id, 'sitesnap.manage_tasks') THEN
    RAISE EXCEPTION 'Only the assignee, the person who added this task, whoever completed it, or someone with task management permission can undo it.';
  END IF;

  SELECT array_agg(storage_path) INTO v_paths FROM public.sitesnap_media WHERE task_id = p_task_id;
  DELETE FROM public.sitesnap_media WHERE task_id = p_task_id;

  UPDATE public.sitesnap_tasks SET status = 'open'
  WHERE id = p_task_id
  RETURNING * INTO v_task;

  RETURN jsonb_build_object('task', to_jsonb(v_task), 'deleted_paths', COALESCE(to_jsonb(v_paths), '[]'::jsonb));
END;
$$;
