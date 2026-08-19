-- ============================================================================
-- SmartCore Presence & Fire Safety — device-level Basic Auth recovery
-- Completes the "Devices" feature in settings.html (device registration
-- existed as a backend endpoint but was never wired into the UI). Adds an
-- optional per-device dedicated login used ONLY for kiosk Basic Auth
-- recovery (see functions/api/kiosk-start.js) — never a real employee's own
-- password. basic_auth_auth_user_id points at that dedicated account.
-- ============================================================================

ALTER TABLE public.presence_fire_safety_devices
  ADD COLUMN IF NOT EXISTS basic_auth_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS basic_auth_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
