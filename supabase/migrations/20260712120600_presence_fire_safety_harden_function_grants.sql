-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 7: Harden function grants
-- Addresses Supabase security advisor findings after migration 1-6:
--  - function_search_path_mutable on the pure-SQL default-permissions helper
--  - anon-executable SECURITY DEFINER helper functions with no legitimate
--    anonymous caller (this module has no unauthenticated flows)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.presence_fire_safety_default_permissions(p_role text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.sign_others_in_out','presence.manage_visitors','presence.manage_contractors',
      'presence.export_reports','presence.manage_settings','presence.manage_badges',
      'evacuation.unlock','evacuation.start','evacuation.manage_roll_call','evacuation.complete','evacuation.export'
    ]
    WHEN 'admin' THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.sign_others_in_out','presence.manage_visitors','presence.manage_contractors',
      'presence.export_reports','presence.manage_settings','presence.manage_badges',
      'evacuation.unlock','evacuation.start','evacuation.manage_roll_call','evacuation.complete','evacuation.export'
    ]
    WHEN 'administrator' THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.sign_others_in_out','presence.manage_visitors','presence.manage_contractors',
      'presence.export_reports','presence.manage_settings','presence.manage_badges',
      'evacuation.unlock','evacuation.start','evacuation.manage_roll_call','evacuation.complete','evacuation.export'
    ]
    WHEN 'manager' THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.sign_others_in_out','presence.manage_visitors','presence.manage_contractors',
      'presence.export_reports'
    ]
    WHEN 'hr' THEN ARRAY[
      'presence.view_own_history','presence.view_live_register','presence.sign_self_in_out',
      'presence.manage_visitors','presence.export_reports'
    ]
    ELSE ARRAY['presence.view_own_history','presence.sign_self_in_out']
  END;
$$;

REVOKE ALL ON FUNCTION public.presence_fire_safety_default_permissions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.presence_fire_safety_current_employee(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.presence_fire_safety_has_permission(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.presence_fire_safety_has_site_access(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.presence_fire_safety_module_enabled(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.presence_fire_safety_default_permissions(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_current_employee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_has_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_has_site_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_module_enabled(uuid) TO authenticated;
