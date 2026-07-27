-- ============================================================================
-- SmartCore SiteSnap — Company-level on/off switch for the admin Live Map
-- (viewing everyone's real-time position). Off by default is not forced —
-- existing companies keep current behaviour (enabled) until an admin
-- deliberately turns it off in Settings.
--
-- Note: this only gates the Live Map *view*. It doesn't stop location pings
-- during an active shift — those still power the geofence auto sign-out,
-- which is a separate feature from live tracking visibility.
-- ============================================================================

ALTER TABLE public.sitesnap_settings
  ADD COLUMN IF NOT EXISTS live_map_enabled boolean NOT NULL DEFAULT true;
