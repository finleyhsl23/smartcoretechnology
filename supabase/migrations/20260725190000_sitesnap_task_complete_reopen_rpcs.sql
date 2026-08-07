-- ============================================================================
-- SmartCore SiteSnap — Dedicated RPCs for completing/reopening a task.
--
-- tasks.update(id, patch) does a raw RLS-filtered UPDATE ... SELECT ... .
-- single(). Whenever the sitesnap_tasks_update policy's USING clause quietly
-- excludes the row (e.g. an unassigned task and a caller who is neither the
-- assignee nor a task manager), the UPDATE affects zero rows and PostgREST's
-- .single() throws "Cannot coerce the result to a single JSON object" —
-- a real bug reproduced on an unassigned task ("Tasky") where the RLS
-- boundary was hit and produced this opaque error instead of a clear one.
--
-- These RPCs do the same authorization check explicitly up front and raise
-- a readable message on failure. sitesnap_reopen_task also makes photo
-- deletion + status flip atomic (previously the client deleted the photo
-- row first and only then tried to update the task — a failure on the
-- second step left a 'done' task with no photo).
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
     AND NOT public.sitesnap_has_permission(v_task.company_id, 'sitesnap.manage_tasks') THEN
    RAISE EXCEPTION 'Only the assignee or someone with task management permission can complete this task.';
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
REVOKE ALL ON FUNCTION public.sitesnap_complete_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sitesnap_complete_task(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sitesnap_complete_task(uuid) FROM anon;

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
     AND NOT public.sitesnap_has_permission(v_task.company_id, 'sitesnap.manage_tasks') THEN
    RAISE EXCEPTION 'Only the assignee or someone with task management permission can undo this task.';
  END IF;

  SELECT array_agg(storage_path) INTO v_paths FROM public.sitesnap_media WHERE task_id = p_task_id;
  DELETE FROM public.sitesnap_media WHERE task_id = p_task_id;

  UPDATE public.sitesnap_tasks SET status = 'open'
  WHERE id = p_task_id
  RETURNING * INTO v_task;

  -- Storage objects can't be deleted from SQL (Postgres can't reach the
  -- storage backend, only its metadata table) — the client deletes the
  -- actual files via the Storage API using these paths.
  RETURN jsonb_build_object('task', to_jsonb(v_task), 'deleted_paths', COALESCE(to_jsonb(v_paths), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.sitesnap_reopen_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sitesnap_reopen_task(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sitesnap_reopen_task(uuid) FROM anon;
