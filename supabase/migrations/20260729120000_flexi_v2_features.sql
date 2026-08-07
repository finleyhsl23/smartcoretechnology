-- ============================================================================
-- SmartCore Flexi — v2 feature set:
--   * class attendance tracking on bookings
--   * check-in photo attachments
--   * nutrition plan goal + a shared recommended-meals / meal-plan library
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Attendance — ticking a client off at a class session. attended/attended_at
-- live on the booking row itself (no new table) so it shows up wherever
-- bookings already surface, e.g. the client's Bookings tab.
-- ----------------------------------------------------------------------------
ALTER TABLE public.smartcore_flexi_bookings
  ADD COLUMN IF NOT EXISTS attended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attended_at timestamptz;

-- ----------------------------------------------------------------------------
-- Check-in photo attachments — client-submitted, stored in flexi-media under
-- the same <company_id>/<client_id>/checkins/ convention as progress photos.
-- ----------------------------------------------------------------------------
ALTER TABLE public.smartcore_flexi_checkins
  ADD COLUMN IF NOT EXISTS photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS notes text;

-- ----------------------------------------------------------------------------
-- Nutrition plans — goal tag (for the macro calculator) + optional link to a
-- recommended meal plan from the library below.
-- ----------------------------------------------------------------------------
ALTER TABLE public.smartcore_flexi_nutrition_plans
  ADD COLUMN IF NOT EXISTS goal text;

-- ----------------------------------------------------------------------------
-- Recommended meals & meal plans — a per-company library trainers build once
-- and reuse across clients/nutrition plans.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_meals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  meal_type    text NOT NULL DEFAULT 'meal' CHECK (meal_type IN ('breakfast','lunch','dinner','snack','meal')),
  calories     integer,
  protein_g    integer,
  carbs_g      integer,
  fat_g        integer,
  ingredients  text,
  instructions text,
  created_by   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_meals_company_idx ON public.smartcore_flexi_meals(company_id, meal_type);

ALTER TABLE public.smartcore_flexi_meals ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_meals_staff ON public.smartcore_flexi_meals
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_nutrition'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_nutrition'));

CREATE POLICY smartcore_flexi_meals_client_read ON public.smartcore_flexi_meals
  FOR SELECT USING (company_id = public.flexi_client_company_id());

CREATE TABLE IF NOT EXISTS public.smartcore_flexi_meal_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  goal        text,
  created_by  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_meal_plans_company_idx ON public.smartcore_flexi_meal_plans(company_id);

ALTER TABLE public.smartcore_flexi_meal_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_meal_plans_staff ON public.smartcore_flexi_meal_plans
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_nutrition'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_nutrition'));

CREATE POLICY smartcore_flexi_meal_plans_client_read ON public.smartcore_flexi_meal_plans
  FOR SELECT USING (company_id = public.flexi_client_company_id());

CREATE TABLE IF NOT EXISTS public.smartcore_flexi_meal_plan_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id uuid NOT NULL REFERENCES public.smartcore_flexi_meal_plans(id) ON DELETE CASCADE,
  meal_id      uuid NOT NULL REFERENCES public.smartcore_flexi_meals(id) ON DELETE CASCADE,
  meal_slot    text NOT NULL DEFAULT 'meal' CHECK (meal_slot IN ('breakfast','lunch','dinner','snack','meal')),
  day_of_week  smallint CHECK (day_of_week BETWEEN 0 AND 6),
  order_index  integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_meal_plan_items_plan_idx ON public.smartcore_flexi_meal_plan_items(meal_plan_id, day_of_week, order_index);

ALTER TABLE public.smartcore_flexi_meal_plan_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_meal_plan_items_staff ON public.smartcore_flexi_meal_plan_items
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.smartcore_flexi_meal_plans mp WHERE mp.id = meal_plan_id AND public.flexi_has_permission(mp.company_id, 'flexi.manage_nutrition'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.smartcore_flexi_meal_plans mp WHERE mp.id = meal_plan_id AND public.flexi_has_permission(mp.company_id, 'flexi.manage_nutrition'))
  );

CREATE POLICY smartcore_flexi_meal_plan_items_client_read ON public.smartcore_flexi_meal_plan_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.smartcore_flexi_meal_plans mp WHERE mp.id = meal_plan_id AND mp.company_id = public.flexi_client_company_id())
  );

ALTER TABLE public.smartcore_flexi_nutrition_plans
  ADD COLUMN IF NOT EXISTS meal_plan_id uuid REFERENCES public.smartcore_flexi_meal_plans(id) ON DELETE SET NULL;
