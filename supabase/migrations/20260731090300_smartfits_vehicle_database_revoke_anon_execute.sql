-- ============================================================================
-- Smartfits Vehicle Database — Revoke anon EXECUTE
-- REVOKE ALL FROM PUBLIC does not remove Supabase's separate implicit grant
-- to the `anon` role at function-creation time — every SECURITY DEFINER
-- helper here was still anon-executable despite being STABLE/fail-safe (each
-- already returns NULL/false for anon since auth.uid() is NULL). This module
-- has no legitimate unauthenticated flow, so close the surface explicitly,
-- same hardening step already applied to Convoy/SiteSnap/Presence & Fire
-- Safety.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION smartfitsinstallationsltd.vdb_current_employee_id() FROM anon;
REVOKE EXECUTE ON FUNCTION smartfitsinstallationsltd.vdb_is_owner_or_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION smartfitsinstallationsltd.vdb_is_manager() FROM anon;
REVOKE EXECUTE ON FUNCTION smartfitsinstallationsltd.vdb_photo_can_select(text) FROM anon;
REVOKE EXECUTE ON FUNCTION smartfitsinstallationsltd.vdb_photo_can_insert(text) FROM anon;
REVOKE EXECUTE ON FUNCTION smartfitsinstallationsltd.vdb_photo_can_delete(text) FROM anon;
