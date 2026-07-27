-- ============================================================================
-- SmartCore SiteSnap — Revoke anon EXECUTE on the attendance RPCs.
-- REVOKE ALL FROM PUBLIC does not remove Supabase's separate implicit grant
-- to the `anon` role at function-creation time — same gap fixed for the rest
-- of the module in 20260725100600_sitesnap_revoke_anon_execute.sql, now
-- closed for the new attendance RPCs too. Each already fails safe for anon
-- (auth.uid() is NULL), but this removes the exposed surface too.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.sitesnap_is_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sitesnap_current_active_shift(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sitesnap_clock_in(uuid, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sitesnap_clock_out(uuid, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sitesnap_shift_ping(uuid, numeric, numeric) FROM anon;
