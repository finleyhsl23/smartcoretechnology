-- ============================================================================
-- SmartCore Flexi — Migration 2: Training (exercise library, programs,
-- workouts, workout logging)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.flexi_client_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.company_id FROM public.smartcore_flexi_clients c
  WHERE c.auth_user_id = auth.uid() AND c.auth_user_id IS NOT NULL
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.flexi_client_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.flexi_client_company_id() TO authenticated;

-- ----------------------------------------------------------------------------
-- Exercise library — company_id NULL rows are the shared built-in library
-- seeded below; company_id set rows are a business's own custom exercises.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_exercises (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  name           text NOT NULL,
  category       text NOT NULL DEFAULT 'strength' CHECK (category IN ('strength', 'cardio', 'mobility', 'core', 'plyometric', 'other')),
  muscle_group   text,
  equipment      text,
  video_url      text,
  thumbnail_url  text,
  instructions   text,
  created_by     uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_exercises_company_idx ON public.smartcore_flexi_exercises(company_id);

ALTER TABLE public.smartcore_flexi_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_exercises_select ON public.smartcore_flexi_exercises
  FOR SELECT USING (
    company_id IS NULL
    OR company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
    OR company_id = public.flexi_client_company_id()
  );

CREATE POLICY smartcore_flexi_exercises_write ON public.smartcore_flexi_exercises
  FOR ALL USING (company_id IS NOT NULL AND public.flexi_has_permission(company_id, 'flexi.manage_exercises'))
  WITH CHECK (company_id IS NOT NULL AND public.flexi_has_permission(company_id, 'flexi.manage_exercises'));

-- ----------------------------------------------------------------------------
-- Programs — a block of training assigned to one client (e.g. "8-Week
-- Strength Base"), containing one or more workouts (day templates).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_programs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  trainer_id   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  name         text NOT NULL,
  description  text,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  start_date   date,
  end_date     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_programs_client_idx ON public.smartcore_flexi_programs(client_id);
CREATE INDEX IF NOT EXISTS smartcore_flexi_programs_company_idx ON public.smartcore_flexi_programs(company_id);

ALTER TABLE public.smartcore_flexi_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_programs_staff ON public.smartcore_flexi_programs
  FOR ALL USING (
    public.flexi_has_permission(company_id, 'flexi.manage_programs')
    AND client_id IN (SELECT id FROM public.smartcore_flexi_clients WHERE company_id = smartcore_flexi_programs.company_id)
  ) WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_programs'));

CREATE POLICY smartcore_flexi_programs_client_read ON public.smartcore_flexi_programs
  FOR SELECT USING (client_id = public.flexi_current_client_id() AND status != 'draft');

-- ----------------------------------------------------------------------------
-- Workouts — a single day/session template within a program.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_workouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id   uuid NOT NULL REFERENCES public.smartcore_flexi_programs(id) ON DELETE CASCADE,
  name         text NOT NULL,
  day_label    text,
  order_index  integer NOT NULL DEFAULT 0,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_workouts_program_idx ON public.smartcore_flexi_workouts(program_id);

ALTER TABLE public.smartcore_flexi_workouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_workouts_staff ON public.smartcore_flexi_workouts
  FOR ALL USING (
    program_id IN (
      SELECT p.id FROM public.smartcore_flexi_programs p WHERE public.flexi_has_permission(p.company_id, 'flexi.manage_programs')
    )
  ) WITH CHECK (
    program_id IN (
      SELECT p.id FROM public.smartcore_flexi_programs p WHERE public.flexi_has_permission(p.company_id, 'flexi.manage_programs')
    )
  );

CREATE POLICY smartcore_flexi_workouts_client_read ON public.smartcore_flexi_workouts
  FOR SELECT USING (
    program_id IN (SELECT p.id FROM public.smartcore_flexi_programs p WHERE p.client_id = public.flexi_current_client_id() AND p.status != 'draft')
  );

-- ----------------------------------------------------------------------------
-- Workout exercises — the prescribed sets/reps/weight for one exercise
-- within a workout.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_workout_exercises (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id     uuid NOT NULL REFERENCES public.smartcore_flexi_workouts(id) ON DELETE CASCADE,
  exercise_id    uuid NOT NULL REFERENCES public.smartcore_flexi_exercises(id) ON DELETE RESTRICT,
  order_index    integer NOT NULL DEFAULT 0,
  target_sets    integer,
  target_reps    text,
  target_weight_kg numeric(6,2),
  rest_seconds   integer,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_workout_exercises_workout_idx ON public.smartcore_flexi_workout_exercises(workout_id);

ALTER TABLE public.smartcore_flexi_workout_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_workout_exercises_staff ON public.smartcore_flexi_workout_exercises
  FOR ALL USING (
    workout_id IN (
      SELECT w.id FROM public.smartcore_flexi_workouts w
      JOIN public.smartcore_flexi_programs p ON p.id = w.program_id
      WHERE public.flexi_has_permission(p.company_id, 'flexi.manage_programs')
    )
  ) WITH CHECK (
    workout_id IN (
      SELECT w.id FROM public.smartcore_flexi_workouts w
      JOIN public.smartcore_flexi_programs p ON p.id = w.program_id
      WHERE public.flexi_has_permission(p.company_id, 'flexi.manage_programs')
    )
  );

CREATE POLICY smartcore_flexi_workout_exercises_client_read ON public.smartcore_flexi_workout_exercises
  FOR SELECT USING (
    workout_id IN (
      SELECT w.id FROM public.smartcore_flexi_workouts w
      JOIN public.smartcore_flexi_programs p ON p.id = w.program_id
      WHERE p.client_id = public.flexi_current_client_id() AND p.status != 'draft'
    )
  );

-- ----------------------------------------------------------------------------
-- Workout logs — a client's completed session against a workout template.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_workout_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  workout_id       uuid REFERENCES public.smartcore_flexi_workouts(id) ON DELETE SET NULL,
  company_id       uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  completed_at     timestamptz NOT NULL DEFAULT now(),
  duration_minutes integer,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_workout_logs_client_idx ON public.smartcore_flexi_workout_logs(client_id, completed_at DESC);

ALTER TABLE public.smartcore_flexi_workout_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_workout_logs_staff_read ON public.smartcore_flexi_workout_logs
  FOR SELECT USING (public.flexi_has_permission(company_id, 'flexi.view_clients'));

CREATE POLICY smartcore_flexi_workout_logs_client_all ON public.smartcore_flexi_workout_logs
  FOR ALL USING (client_id = public.flexi_current_client_id())
  WITH CHECK (client_id = public.flexi_current_client_id());

-- ----------------------------------------------------------------------------
-- Exercise logs — the actual sets performed within a workout log.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_exercise_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_log_id        uuid NOT NULL REFERENCES public.smartcore_flexi_workout_logs(id) ON DELETE CASCADE,
  workout_exercise_id   uuid REFERENCES public.smartcore_flexi_workout_exercises(id) ON DELETE SET NULL,
  exercise_id           uuid NOT NULL REFERENCES public.smartcore_flexi_exercises(id) ON DELETE RESTRICT,
  set_number            integer NOT NULL DEFAULT 1,
  reps_done              integer,
  weight_used_kg         numeric(6,2),
  rpe                    numeric(3,1),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_exercise_logs_workout_log_idx ON public.smartcore_flexi_exercise_logs(workout_log_id);

ALTER TABLE public.smartcore_flexi_exercise_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_exercise_logs_staff_read ON public.smartcore_flexi_exercise_logs
  FOR SELECT USING (
    workout_log_id IN (SELECT wl.id FROM public.smartcore_flexi_workout_logs wl WHERE public.flexi_has_permission(wl.company_id, 'flexi.view_clients'))
  );

CREATE POLICY smartcore_flexi_exercise_logs_client_all ON public.smartcore_flexi_exercise_logs
  FOR ALL USING (
    workout_log_id IN (SELECT wl.id FROM public.smartcore_flexi_workout_logs wl WHERE wl.client_id = public.flexi_current_client_id())
  ) WITH CHECK (
    workout_log_id IN (SELECT wl.id FROM public.smartcore_flexi_workout_logs wl WHERE wl.client_id = public.flexi_current_client_id())
  );

-- ----------------------------------------------------------------------------
-- Seed a starter exercise library (global, company_id NULL) so a brand new
-- business isn't staring at an empty program builder.
-- ----------------------------------------------------------------------------
INSERT INTO public.smartcore_flexi_exercises (company_id, name, category, muscle_group, equipment, instructions)
SELECT * FROM (VALUES
  (NULL::uuid, 'Barbell Back Squat', 'strength', 'Legs', 'Barbell', 'Bar on upper back, feet shoulder-width, squat to depth, drive up through the heels.'),
  (NULL::uuid, 'Barbell Deadlift', 'strength', 'Back / Legs', 'Barbell', 'Hinge at the hips, flat back, drive through the floor to stand tall.'),
  (NULL::uuid, 'Bench Press', 'strength', 'Chest', 'Barbell', 'Lower the bar to the chest under control, press back to lock-out.'),
  (NULL::uuid, 'Overhead Press', 'strength', 'Shoulders', 'Barbell', 'Press the bar from shoulders to overhead lock-out, brace the core.'),
  (NULL::uuid, 'Barbell Row', 'strength', 'Back', 'Barbell', 'Hinge forward, row the bar to the lower ribs, squeeze the shoulder blades.'),
  (NULL::uuid, 'Pull-Up', 'strength', 'Back', 'Pull-up bar', 'Hang from the bar, pull the chin over the bar, lower under control.'),
  (NULL::uuid, 'Dumbbell Lunge', 'strength', 'Legs', 'Dumbbells', 'Step forward into a lunge, both knees to ~90°, drive back to standing.'),
  (NULL::uuid, 'Kettlebell Swing', 'strength', 'Posterior Chain', 'Kettlebell', 'Hinge and drive the hips to swing the bell to chest height.'),
  (NULL::uuid, 'Plank', 'core', 'Core', 'Bodyweight', 'Hold a straight line from shoulders to ankles, brace the core.'),
  (NULL::uuid, 'Dead Bug', 'core', 'Core', 'Bodyweight', 'Lower opposite arm and leg while keeping the lower back flat to the floor.'),
  (NULL::uuid, 'Treadmill Run', 'cardio', 'Full Body', 'Treadmill', 'Steady-state or interval running at a prescribed pace.'),
  (NULL::uuid, 'Rowing Machine', 'cardio', 'Full Body', 'Rower', 'Drive with the legs, lean back, pull the handle to the ribs.'),
  (NULL::uuid, 'Box Jump', 'plyometric', 'Legs', 'Plyo box', 'Explosively jump onto the box, land softly, step down.'),
  (NULL::uuid, 'Burpee', 'plyometric', 'Full Body', 'Bodyweight', 'Squat, kick back to a plank, push-up, jump feet in, jump up.'),
  (NULL::uuid, 'Hip Flexor Stretch', 'mobility', 'Hips', 'Bodyweight', 'Kneeling lunge position, push the hips forward, hold.'),
  (NULL::uuid, 'Thoracic Rotation', 'mobility', 'Upper Back', 'Bodyweight', 'Quadruped position, rotate one arm up and open the chest.')
) AS seed(company_id, name, category, muscle_group, equipment, instructions)
WHERE NOT EXISTS (SELECT 1 FROM public.smartcore_flexi_exercises WHERE company_id IS NULL);
