-- ============================================================================
-- SmartCore Flexi — generic (client-less) program templates.
-- A "template" is a smartcore_flexi_programs row with client_id NULL and
-- is_template true; it carries its own workouts/workout_exercises exactly
-- like a client program does, so the existing program builder UI and RLS
-- shape are reused as-is. Assigning a template to a client clones its
-- workouts/exercises into a brand new client_id-bound program row.
-- ============================================================================

ALTER TABLE public.smartcore_flexi_programs
  ALTER COLUMN client_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;

ALTER TABLE public.smartcore_flexi_programs
  DROP CONSTRAINT IF EXISTS smartcore_flexi_programs_client_or_template;
ALTER TABLE public.smartcore_flexi_programs
  ADD CONSTRAINT smartcore_flexi_programs_client_or_template CHECK (client_id IS NOT NULL OR is_template);

DROP POLICY IF EXISTS smartcore_flexi_programs_staff ON public.smartcore_flexi_programs;
CREATE POLICY smartcore_flexi_programs_staff ON public.smartcore_flexi_programs
  FOR ALL USING (
    public.flexi_has_permission(company_id, 'flexi.manage_programs')
    AND (
      is_template
      OR client_id IN (SELECT id FROM public.smartcore_flexi_clients WHERE company_id = smartcore_flexi_programs.company_id)
    )
  ) WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_programs'));

ALTER TABLE public.smartcore_flexi_workouts
  ADD COLUMN IF NOT EXISTS is_rest_day boolean NOT NULL DEFAULT false;
