-- ============================================================================
-- SmartCore Presence & Fire Safety — Kiosk idle screensaver on/off setting
-- ============================================================================

ALTER TABLE public.presence_fire_safety_settings
  ADD COLUMN IF NOT EXISTS kiosk_screensaver_enabled boolean NOT NULL DEFAULT true;
