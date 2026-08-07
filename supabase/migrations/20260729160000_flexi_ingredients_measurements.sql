-- ============================================================================
-- SmartCore Flexi — structured recipe ingredients (qty + unit + name) and
-- body measurements on progress entries.
-- ============================================================================

ALTER TABLE public.smartcore_flexi_meals
  ADD COLUMN IF NOT EXISTS ingredients_structured jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.smartcore_flexi_progress_entries
  ADD COLUMN IF NOT EXISTS measurements jsonb;
