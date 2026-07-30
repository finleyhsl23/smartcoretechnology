-- ============================================================================
-- SmartCore Flexi — track which built-in exercise a company-owned exercise
-- was cloned from ("Add My Video"), so the redundant built-in card can be
-- hidden from that company's library once they have their own copy —
-- without ever touching the shared global row (companies can't write to
-- company_id IS NULL rows at all; that's enforced by RLS already, and
-- rightly so — deleting it would remove it for every other company).
-- ============================================================================

ALTER TABLE public.smartcore_flexi_exercises
  ADD COLUMN IF NOT EXISTS cloned_from_id uuid REFERENCES public.smartcore_flexi_exercises(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS smartcore_flexi_exercises_cloned_from_idx ON public.smartcore_flexi_exercises(cloned_from_id);
