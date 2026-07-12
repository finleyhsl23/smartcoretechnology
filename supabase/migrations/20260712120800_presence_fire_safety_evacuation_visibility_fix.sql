-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 9: Evacuation visibility fix
-- The original pfs_evac_sessions_select policy required presence.view_live_
-- register, meaning an ordinary Employee-role user (who only holds
-- presence.view_own_history + presence.sign_self_in_out by default) could not
-- see that an evacuation was active at all. During a real emergency, knowing
-- "an evacuation is in progress, go to the assembly point" must not be
-- gated behind an administrative permission. This adds a second, narrower
-- policy: any company member with access to the site can see ACTIVE session
-- rows (id, site, status, assembly point, timing) regardless of permission.
-- Completed/cancelled session history and the detailed roll-call list
-- (who is marked safe/missing) remain restricted to view_live_register,
-- since that is administrative detail, not an emergency safety signal.
-- ============================================================================

CREATE POLICY pfs_evac_sessions_select_active_any_member ON public.presence_fire_safety_evacuation_sessions
  FOR SELECT USING (
    status = 'active'
    AND public.presence_fire_safety_has_site_access(company_id, site_id)
  );
