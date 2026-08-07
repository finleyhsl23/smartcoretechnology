-- ============================================================================
-- SmartCore Convoy — harden convoy_check_submit_raise_defects grants
-- It's a SECURITY DEFINER trigger function (needs to insert into
-- convoy_defects regardless of the driver's own manage_defects permission),
-- which makes Supabase's advisor flag it as reachable via
-- /rest/v1/rpc/convoy_check_submit_raise_defects. Postgres itself refuses to
-- run a RETURNS trigger function outside trigger context, so this isn't
-- actually exploitable, but revoke EXECUTE explicitly anyway as
-- defense-in-depth, mirroring the anon-execute hardening used everywhere
-- else in this module.
-- ============================================================================

REVOKE ALL ON FUNCTION public.convoy_check_submit_raise_defects() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.convoy_check_submit_raise_defects() FROM anon;
REVOKE EXECUTE ON FUNCTION public.convoy_check_submit_raise_defects() FROM authenticated;
