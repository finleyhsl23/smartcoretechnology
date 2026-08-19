-- ============================================================================
-- SmartCore Presence & Fire Safety — self-signed kiosk sessions
-- Kiosk device "accounts" no longer create a real Supabase Auth user at
-- all (see functions/api/presence-fire-safety/_kiosk_jwt.js) — instead a
-- random UUID is stored directly as core_employees.auth_user_id (that
-- column has no FK to auth.users, confirmed before this change), and
-- functions/api/kiosk-start.js / kiosk-switch-session.js sign a JWT for it
-- themselves using the project's JWT secret. Basic Auth recovery
-- credentials move from "a real Supabase password" to a device-owned
-- username + hashed password checked directly against this table.
-- ============================================================================

ALTER TABLE public.presence_fire_safety_devices
  ADD COLUMN IF NOT EXISTS basic_auth_username text UNIQUE,
  ADD COLUMN IF NOT EXISTS basic_auth_password_hash text;
