-- ============================================================================
-- SmartCore Convoy — Revoke anon EXECUTE
-- REVOKE ALL FROM PUBLIC does not remove Supabase's separate implicit grant
-- to the `anon` role at function-creation time — every SECURITY DEFINER
-- helper here was still anon-executable despite the earlier REVOKE ALL FROM
-- PUBLIC. This module has no legitimate unauthenticated flow, so close it
-- explicitly as defense-in-depth (each function already fails safe for anon
-- since auth.uid() is NULL, but this removes the exposed surface too).
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.convoy_current_employee(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.convoy_current_employee_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.convoy_has_permission(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.convoy_module_enabled(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.convoy_my_permissions(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.convoy_default_permissions(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.convoy_distance_metres(numeric, numeric, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.convoy_seed_default_template(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.convoy_submit_check(uuid, numeric, numeric, numeric, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.convoy_ensure_settings(uuid) FROM anon;
