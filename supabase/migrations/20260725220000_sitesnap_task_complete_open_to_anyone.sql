-- ============================================================================
-- SmartCore SiteSnap — Anyone who can see a task can complete it; only
-- undoing it is restricted (to the assignee, creator, completer, or a task
-- manager — unchanged, see sitesnap_reopen_task).
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
  IF NOT EXISTS (SELECT 1 FROM public.sitesnap_media m WHERE m.task_id = p_task_id) THEN
    RAISE EXCEPTION 'Attach a photo before marking this task done.';
  END IF;

  UPDATE public.sitesnap_tasks SET status = 'done'
  WHERE id = p_task_id
  RETURNING * INTO v_task;

  RETURN v_task;
END;
$$;
