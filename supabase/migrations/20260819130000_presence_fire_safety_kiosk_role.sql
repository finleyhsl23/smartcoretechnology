-- ============================================================================
-- SmartCore Presence & Fire Safety — dedicated 'kiosk' employee role
-- A kiosk device's dedicated login (see functions/api/presence-fire-safety/
-- devices-register.js) needs full module access so the kiosk UI works, but
-- must NEVER be treated as a real admin/owner account elsewhere on the
-- platform — 'kiosk' is a role value distinct from 'admin' so every other
-- module's own admin checks (which look for 'owner'/'admin' specifically)
-- naturally exclude it, while these two presence-fire-safety RPCs grant it
-- the same in-module access as admin.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.presence_fire_safety_my_permissions(p_company_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN ce.role IN ('owner', 'admin', 'administrator', 'kiosk') THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.sign_others_in_out','presence.manage_visitors','presence.manage_contractors',
      'presence.export_reports','presence.manage_settings','presence.manage_badges',
      'evacuation.unlock','evacuation.start','evacuation.manage_roll_call','evacuation.complete','evacuation.export',
      'presence.view_timesheets','presence.leaving_check'
    ]
    ELSE (
      SELECT array_agg(DISTINCT p) FROM (
        SELECT unnest(public.presence_fire_safety_default_permissions(ce.role)) AS p
        UNION
        SELECT g.permission FROM public.presence_fire_safety_permission_grants g
        WHERE g.company_id = p_company_id AND g.employee_id = ce.id
      ) perms
    )
  END
  FROM public.core_employees ce
  WHERE ce.auth_user_id = auth.uid() AND ce.company_id = p_company_id AND ce.auth_user_id IS NOT NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.presence_fire_safety_has_permission(p_company_id uuid, p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.core_employees ce
    WHERE ce.auth_user_id = auth.uid()
      AND ce.company_id = p_company_id
      AND ce.auth_user_id IS NOT NULL
      AND (
        ce.role IN ('owner', 'admin', 'administrator', 'kiosk')
        OR p_permission = ANY(public.presence_fire_safety_default_permissions(ce.role))
        OR EXISTS (
          SELECT 1 FROM public.presence_fire_safety_permission_grants g
          WHERE g.company_id = p_company_id AND g.employee_id = ce.id AND g.permission = p_permission
        )
      )
  );
$$;
