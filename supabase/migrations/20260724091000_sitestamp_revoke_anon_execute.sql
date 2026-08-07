-- ============================================================================
-- SmartCore SiteStamp — Revoke anon EXECUTE
-- REVOKE ALL FROM PUBLIC does not remove Supabase's separate implicit grant
-- to the `anon` role at function-creation time (the same gap fixed for
-- Presence & Fire Safety in 20260712120900) — every SECURITY DEFINER helper
-- here was still anon-executable despite the earlier REVOKE ALL FROM PUBLIC.
-- This module has no legitimate unauthenticated flow at all, so close it
-- explicitly as defense-in-depth (each function already fails safe for
-- anon since auth.uid() is NULL, but this removes the exposed surface too).
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.sitestamp_current_employee(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sitestamp_current_employee_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sitestamp_has_permission(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sitestamp_module_enabled(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sitestamp_my_permissions(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sitestamp_can_access_project(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sitestamp_default_permissions(text) FROM anon;
