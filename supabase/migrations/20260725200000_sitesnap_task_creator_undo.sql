-- ============================================================================
-- SmartCore SiteSnap — Let the task's creator complete/undo it too, not just
-- the assignee or a task manager. created_by was already recorded on every
-- task (set at creation) but never checked as an authorization path.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sitesnap_complete_task(p_task_id uuid)
RETURNS public.sitesnap_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_id uuid;
  v_task public.sitesnap_tasks;
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
     AND NOT public.sitesnap_has_permission(v_task.company_id, 'sitesnap.manage_tasks') THEN
    RAISE EXCEPTION 'Only the assignee, the person who added this task, or someone with task management permission can complete it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sitesnap_media m WHERE m.task_id = p_task_id) THEN
    RAISE EXCEPTION 'Attach a photo before marking this task done.';
  END IF;

  UPDATE public.sitesnap_tasks SET status = 'done'
  WHERE id = p_task_id
  RETURNING * INTO v_task;

  RETURN v_task;
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
     AND NOT public.sitesnap_has_permission(v_task.company_id, 'sitesnap.manage_tasks') THEN
    RAISE EXCEPTION 'Only the assignee, the person who added this task, or someone with task management permission can undo it.';
  END IF;

  SELECT array_agg(storage_path) INTO v_paths FROM public.sitesnap_media WHERE task_id = p_task_id;
  DELETE FROM public.sitesnap_media WHERE task_id = p_task_id;

  UPDATE public.sitesnap_tasks SET status = 'open'
  WHERE id = p_task_id
  RETURNING * INTO v_task;

  RETURN jsonb_build_object('task', to_jsonb(v_task), 'deleted_paths', COALESCE(to_jsonb(v_paths), '[]'::jsonb));
END;
$$;
