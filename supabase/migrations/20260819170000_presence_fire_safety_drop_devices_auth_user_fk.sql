-- ============================================================================
-- SmartCore Presence & Fire Safety — drop the leftover auth.users FK
-- presence_fire_safety_devices.basic_auth_auth_user_id was originally added
-- (20260817140000) back when kiosk Basic Auth still created a real Supabase
-- Auth user, with a FK to auth.users(id) to match. The redesign in
-- 20260819160000 stopped creating real auth users entirely — this column
-- now stores a synthetic UUID (core_employees.auth_user_id has no such FK,
-- confirmed deliberately), but the FK on THIS table was missed and left
-- registration failing with a foreign key violation ever since.
-- ============================================================================

ALTER TABLE public.presence_fire_safety_devices
  DROP CONSTRAINT IF EXISTS presence_fire_safety_devices_basic_auth_auth_user_id_fkey;
