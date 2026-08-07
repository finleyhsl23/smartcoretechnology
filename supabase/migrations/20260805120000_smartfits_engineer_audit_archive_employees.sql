-- ============================================================================
-- Smartfits Engineer Install Audit — archive support for employees
-- Adds a soft-archive flag to public.core_employees (shared platform table).
-- Defaults to false so every existing row/system is unaffected; only the
-- Engineer Install Audit module's own employee-listing query filters on it,
-- so archived people disappear from its pickers/leaderboard/assignments
-- while their profile and history stay reachable directly by id.
-- ============================================================================

ALTER TABLE public.core_employees
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
