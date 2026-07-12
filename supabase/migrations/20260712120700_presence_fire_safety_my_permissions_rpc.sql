-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 8: my_permissions RPC
-- Single round-trip helper the client uses to drive show/hide UI. Every
-- privileged action is still re-checked server-side by the RPCs/RLS in
-- earlier migrations — this function is a UI convenience only, never a
-- security boundary in itself.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.presence_fire_safety_my_permissions(p_company_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN ce.role IN ('owner', 'admin', 'administrator') THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.sign_others_in_out','presence.manage_visitors','presence.manage_contractors',
      'presence.export_reports','presence.manage_settings','presence.manage_badges',
      'evacuation.unlock','evacuation.start','evacuation.manage_roll_call','evacuation.complete','evacuation.export'
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
REVOKE ALL ON FUNCTION public.presence_fire_safety_my_permissions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_my_permissions(uuid) TO authenticated;
