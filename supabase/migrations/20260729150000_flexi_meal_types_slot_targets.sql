-- ============================================================================
-- SmartCore Flexi — meal library upgrades:
--   * meals can belong to multiple meal types (breakfast+snack etc.)
--   * meal plans get per-slot macro targets, with multiple meal choices per slot
--   * food logs can reference a library meal or carry a client's own macros
-- ============================================================================

ALTER TABLE public.smartcore_flexi_meals
  ADD COLUMN IF NOT EXISTS meal_types text[] NOT NULL DEFAULT ARRAY['meal']::text[];

UPDATE public.smartcore_flexi_meals SET meal_types = ARRAY[meal_type] WHERE meal_type IS NOT NULL;

ALTER TABLE public.smartcore_flexi_meals DROP CONSTRAINT IF EXISTS smartcore_flexi_meals_meal_type_check;
ALTER TABLE public.smartcore_flexi_meals DROP COLUMN IF EXISTS meal_type;

CREATE TABLE IF NOT EXISTS public.smartcore_flexi_meal_plan_slot_targets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id     uuid NOT NULL REFERENCES public.smartcore_flexi_meal_plans(id) ON DELETE CASCADE,
  slot             text NOT NULL CHECK (slot IN ('breakfast','lunch','dinner','snack','meal')),
  target_calories  integer,
  target_protein_g integer,
  target_carbs_g   integer,
  target_fat_g     integer,
  UNIQUE(meal_plan_id, slot)
);

ALTER TABLE public.smartcore_flexi_meal_plan_slot_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_meal_plan_slot_targets_staff ON public.smartcore_flexi_meal_plan_slot_targets
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.smartcore_flexi_meal_plans mp WHERE mp.id = meal_plan_id AND public.flexi_has_permission(mp.company_id, 'flexi.manage_nutrition'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.smartcore_flexi_meal_plans mp WHERE mp.id = meal_plan_id AND public.flexi_has_permission(mp.company_id, 'flexi.manage_nutrition'))
  );

CREATE POLICY smartcore_flexi_meal_plan_slot_targets_client_read ON public.smartcore_flexi_meal_plan_slot_targets
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.smartcore_flexi_meal_plans mp WHERE mp.id = meal_plan_id AND mp.company_id = public.flexi_client_company_id())
  );

ALTER TABLE public.smartcore_flexi_food_logs
  ADD COLUMN IF NOT EXISTS protein_g integer,
  ADD COLUMN IF NOT EXISTS carbs_g integer,
  ADD COLUMN IF NOT EXISTS fat_g integer,
  ADD COLUMN IF NOT EXISTS meal_id uuid REFERENCES public.smartcore_flexi_meals(id) ON DELETE SET NULL;
