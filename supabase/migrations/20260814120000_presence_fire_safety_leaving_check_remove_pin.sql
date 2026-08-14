-- Remove the Leaving PIN system entirely — replaced by a grantable
-- permission (presence.leaving_check) instead of a shared rotating PIN.
-- Whoever holds the permission gets prompted after signing themselves out
-- to review who's still on site, no PIN entry required at all.

DROP FUNCTION IF EXISTS public.presence_fire_safety_rotate_leaving_pin(uuid);
DROP FUNCTION IF EXISTS public.presence_fire_safety_verify_leaving_pin(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.presence_fire_safety_flag_not_signed_out(uuid, uuid, uuid, text);

DROP TABLE IF EXISTS public.presence_fire_safety_leaving_pin_unlocks;
DROP TABLE IF EXISTS public.presence_fire_safety_leaving_pin_attempts;
DROP TABLE IF EXISTS public.presence_fire_safety_leaving_pin_holders;

ALTER TABLE public.presence_fire_safety_settings
  DROP COLUMN IF EXISTS leaving_pin_hash,
  DROP COLUMN IF EXISTS leaving_pin_rotated_at;

ALTER TABLE public.presence_fire_safety_settings
  RENAME COLUMN leaving_pin_query_emails TO leaving_check_query_emails;

-- Flags someone as not signed out — now gated by the presence.leaving_check
-- permission directly (grantable per-employee, same mechanism as any other
-- permission) instead of requiring a live PIN-unlock token.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_flag_not_signed_out(
  p_company_id uuid, p_site_id uuid, p_flagged_employee_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_caller public.core_employees;
BEGIN
  IF NOT public.presence_fire_safety_has_permission(p_company_id, 'presence.leaving_check') THEN
    RAISE EXCEPTION 'Missing permission: presence.leaving_check' USING ERRCODE = '42501';
  END IF;
  IF NOT public.presence_fire_safety_has_site_access(p_company_id, p_site_id) THEN
    RAISE EXCEPTION 'No access to this site' USING ERRCODE = '42501';
  END IF;

  v_caller := public.presence_fire_safety_current_employee(p_company_id);
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.presence_fire_safety_leaving_flags (company_id, site_id, flagged_employee_id, flagged_by_employee_id)
  VALUES (p_company_id, p_site_id, p_flagged_employee_id, v_caller.id);

  INSERT INTO public.presence_fire_safety_audit_logs (company_id, site_id, actor_employee_id, action, entity_type, entity_id)
  VALUES (p_company_id, p_site_id, v_caller.id, 'leaving_check_flagged_not_signed_out', 'employee', p_flagged_employee_id);

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_flag_not_signed_out(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_flag_not_signed_out(uuid, uuid, uuid) TO authenticated;

-- presence.leaving_check joins presence.view_timesheets as an
-- owner/admin/administrator-always-has-it permission; everyone else needs
-- an explicit grant via presence_fire_safety_permission_grants, same as
-- any other non-default permission.
CREATE OR REPLACE FUNCTION public.presence_fire_safety_my_permissions(p_company_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN ce.role IN ('owner', 'admin', 'administrator') THEN ARRAY[
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
