-- ============================================================================
-- SmartCore Flexi — cardio target units + drawn waiver signatures.
-- Canonical storage stays metric (km/h, metres) — the trainer-facing unit
-- toggle in the program builder only converts what's displayed/typed.
-- ============================================================================

ALTER TABLE public.smartcore_flexi_workout_exercises
  ADD COLUMN IF NOT EXISTS target_speed_kmh numeric(6,2),
  ADD COLUMN IF NOT EXISTS target_distance_m numeric(8,1);

ALTER TABLE public.smartcore_flexi_waiver_signatures
  ADD COLUMN IF NOT EXISTS signature_image_url text;
