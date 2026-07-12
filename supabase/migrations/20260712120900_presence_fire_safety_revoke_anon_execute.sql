-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 10: Revoke anon EXECUTE
-- Migration 20260712120600 revoked EXECUTE from PUBLIC, but Supabase grants
-- EXECUTE directly to the `anon` role at function-creation time (a separate
-- grant, not inherited via PUBLIC) — so every function in this module was
-- still anon-executable despite that earlier revoke. Every RPC here already
-- fails safely for unauthenticated callers (auth.uid() is NULL, so the
-- internal employee/permission lookups never match), but this module has no
-- legitimate unauthenticated flow at all, so explicitly closing the anon
-- grant is the correct defense-in-depth fix rather than relying on that
-- internal check alone.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_current_employee(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_has_permission(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_has_site_access(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_module_enabled(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_default_permissions(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_my_permissions(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_record_presence_event(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_create_visitor_visit(uuid, uuid, text, text, text, text, text, text, uuid, text, text, boolean, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_sign_out_visitor(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_create_contractor_visit(uuid, uuid, text, text, text, text, uuid, text, text, text, boolean, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_sign_out_contractor(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_set_evacuation_pin(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_verify_evacuation_pin(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_start_evacuation(uuid, uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_update_roll_call(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.presence_fire_safety_complete_evacuation(uuid) FROM anon;
