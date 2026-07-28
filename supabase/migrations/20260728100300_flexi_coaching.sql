-- ============================================================================
-- SmartCore Flexi — Migration 4: Messaging, progress, nutrition, habits,
-- check-ins, waivers and community/challenges
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Messages — 1:1 thread between a trainer and a client.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  sender_type    text NOT NULL CHECK (sender_type IN ('trainer', 'client')),
  sender_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  body           text NOT NULL,
  attachment_url text,
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_messages_client_idx ON public.smartcore_flexi_messages(client_id, created_at);

ALTER TABLE public.smartcore_flexi_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_messages_staff ON public.smartcore_flexi_messages
  FOR ALL USING (
    public.flexi_has_permission(company_id, 'flexi.send_messages')
    AND client_id IN (
      SELECT c.id FROM public.smartcore_flexi_clients c
      WHERE c.company_id = smartcore_flexi_messages.company_id
        AND (public.flexi_is_admin(c.company_id) OR c.trainer_id IS NULL OR c.trainer_id = public.flexi_current_employee_id(c.company_id))
    )
  ) WITH CHECK (public.flexi_has_permission(company_id, 'flexi.send_messages') AND sender_type = 'trainer');

CREATE POLICY smartcore_flexi_messages_client ON public.smartcore_flexi_messages
  FOR SELECT USING (client_id = public.flexi_current_client_id());

CREATE POLICY smartcore_flexi_messages_client_insert ON public.smartcore_flexi_messages
  FOR INSERT WITH CHECK (client_id = public.flexi_current_client_id() AND sender_type = 'client');

-- ----------------------------------------------------------------------------
-- Progress entries — weight, body fat, measurements, photos over time.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_progress_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  logged_at       date NOT NULL DEFAULT current_date,
  weight_kg       numeric(6,2),
  body_fat_pct    numeric(4,1),
  measurements    jsonb DEFAULT '{}',
  photo_urls      text[] DEFAULT '{}',
  notes           text,
  logged_by       text NOT NULL DEFAULT 'client' CHECK (logged_by IN ('client', 'trainer')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_progress_entries_client_idx ON public.smartcore_flexi_progress_entries(client_id, logged_at DESC);

ALTER TABLE public.smartcore_flexi_progress_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_progress_entries_staff_read ON public.smartcore_flexi_progress_entries
  FOR SELECT USING (public.flexi_has_permission(company_id, 'flexi.view_clients'));

CREATE POLICY smartcore_flexi_progress_entries_staff_write ON public.smartcore_flexi_progress_entries
  FOR INSERT WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_clients'));

CREATE POLICY smartcore_flexi_progress_entries_client_all ON public.smartcore_flexi_progress_entries
  FOR ALL USING (client_id = public.flexi_current_client_id())
  WITH CHECK (client_id = public.flexi_current_client_id());

-- ----------------------------------------------------------------------------
-- Nutrition plans + food diary
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_nutrition_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  trainer_id     uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  name           text NOT NULL,
  daily_calories integer,
  protein_g      integer,
  carbs_g        integer,
  fat_g          integer,
  notes          text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_nutrition_plans_client_idx ON public.smartcore_flexi_nutrition_plans(client_id);

ALTER TABLE public.smartcore_flexi_nutrition_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_nutrition_plans_staff ON public.smartcore_flexi_nutrition_plans
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_nutrition'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_nutrition'));

CREATE POLICY smartcore_flexi_nutrition_plans_client_read ON public.smartcore_flexi_nutrition_plans
  FOR SELECT USING (client_id = public.flexi_current_client_id());

CREATE TABLE IF NOT EXISTS public.smartcore_flexi_food_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  logged_at    date NOT NULL DEFAULT current_date,
  meal         text NOT NULL DEFAULT 'snack' CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
  description  text NOT NULL,
  calories     integer,
  protein_g    integer,
  carbs_g      integer,
  fat_g        integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_food_logs_client_idx ON public.smartcore_flexi_food_logs(client_id, logged_at DESC);

ALTER TABLE public.smartcore_flexi_food_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_food_logs_staff_read ON public.smartcore_flexi_food_logs
  FOR SELECT USING (public.flexi_has_permission(company_id, 'flexi.view_clients'));

CREATE POLICY smartcore_flexi_food_logs_client_all ON public.smartcore_flexi_food_logs
  FOR ALL USING (client_id = public.flexi_current_client_id())
  WITH CHECK (client_id = public.flexi_current_client_id());

-- ----------------------------------------------------------------------------
-- Habits + daily habit log (automated check-in style)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_habits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  trainer_id   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  title        text NOT NULL,
  frequency    text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('daily', 'weekly')),
  target_per_period integer NOT NULL DEFAULT 1,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_habits_client_idx ON public.smartcore_flexi_habits(client_id);

ALTER TABLE public.smartcore_flexi_habits ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_habits_staff ON public.smartcore_flexi_habits
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_checkins'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_checkins'));

CREATE POLICY smartcore_flexi_habits_client_read ON public.smartcore_flexi_habits
  FOR SELECT USING (client_id = public.flexi_current_client_id());

CREATE TABLE IF NOT EXISTS public.smartcore_flexi_habit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id     uuid NOT NULL REFERENCES public.smartcore_flexi_habits(id) ON DELETE CASCADE,
  logged_date  date NOT NULL DEFAULT current_date,
  completed    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(habit_id, logged_date)
);

ALTER TABLE public.smartcore_flexi_habit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_habit_logs_staff_read ON public.smartcore_flexi_habit_logs
  FOR SELECT USING (
    habit_id IN (SELECT h.id FROM public.smartcore_flexi_habits h WHERE public.flexi_has_permission(h.company_id, 'flexi.view_clients'))
  );

CREATE POLICY smartcore_flexi_habit_logs_client_all ON public.smartcore_flexi_habit_logs
  FOR ALL USING (
    habit_id IN (SELECT h.id FROM public.smartcore_flexi_habits h WHERE h.client_id = public.flexi_current_client_id())
  ) WITH CHECK (
    habit_id IN (SELECT h.id FROM public.smartcore_flexi_habits h WHERE h.client_id = public.flexi_current_client_id())
  );

-- ----------------------------------------------------------------------------
-- Check-ins — scheduled structured wellbeing questionnaires.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_checkins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  client_id    uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  trainer_id   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  title        text NOT NULL DEFAULT 'Weekly Check-In',
  questions    jsonb NOT NULL DEFAULT '["How did training feel this week?","Energy levels (1-10)?","Sleep quality (1-10)?","Anything I should know?"]',
  due_date     date NOT NULL DEFAULT (current_date + interval '7 days'),
  submitted_at timestamptz,
  responses    jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_checkins_client_idx ON public.smartcore_flexi_checkins(client_id, due_date DESC);

ALTER TABLE public.smartcore_flexi_checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_checkins_staff ON public.smartcore_flexi_checkins
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_checkins'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_checkins'));

CREATE POLICY smartcore_flexi_checkins_client_read ON public.smartcore_flexi_checkins
  FOR SELECT USING (client_id = public.flexi_current_client_id());

CREATE POLICY smartcore_flexi_checkins_client_submit ON public.smartcore_flexi_checkins
  FOR UPDATE USING (client_id = public.flexi_current_client_id())
  WITH CHECK (client_id = public.flexi_current_client_id());

-- ----------------------------------------------------------------------------
-- Waivers / PAR-Q — digital liability & health-screening forms.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_waivers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.smartcore_flexi_waivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_waivers_staff ON public.smartcore_flexi_waivers
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_waivers'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_waivers'));

CREATE POLICY smartcore_flexi_waivers_client_read ON public.smartcore_flexi_waivers
  FOR SELECT USING (active AND company_id = public.flexi_client_company_id());

CREATE TABLE IF NOT EXISTS public.smartcore_flexi_waiver_signatures (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waiver_id      uuid NOT NULL REFERENCES public.smartcore_flexi_waivers(id) ON DELETE CASCADE,
  client_id      uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  signed_at      timestamptz NOT NULL DEFAULT now(),
  signature_name text NOT NULL,
  UNIQUE(waiver_id, client_id)
);

ALTER TABLE public.smartcore_flexi_waiver_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_waiver_signatures_staff_read ON public.smartcore_flexi_waiver_signatures
  FOR SELECT USING (public.flexi_has_permission(company_id, 'flexi.view_clients'));

CREATE POLICY smartcore_flexi_waiver_signatures_client_all ON public.smartcore_flexi_waiver_signatures
  FOR ALL USING (client_id = public.flexi_current_client_id())
  WITH CHECK (client_id = public.flexi_current_client_id());

-- ----------------------------------------------------------------------------
-- Community — shared posts + challenges/leaderboards (Studio tier+).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_community_posts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  author_client_id   uuid REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  author_employee_id uuid REFERENCES public.core_employees(id) ON DELETE CASCADE,
  body               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(author_client_id, author_employee_id) = 1)
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_community_posts_company_idx ON public.smartcore_flexi_community_posts(company_id, created_at DESC);

ALTER TABLE public.smartcore_flexi_community_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_community_posts_read ON public.smartcore_flexi_community_posts
  FOR SELECT USING (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
    OR company_id = public.flexi_client_company_id()
  );

CREATE POLICY smartcore_flexi_community_posts_staff_write ON public.smartcore_flexi_community_posts
  FOR INSERT WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_community') AND author_employee_id IS NOT NULL);

CREATE POLICY smartcore_flexi_community_posts_client_write ON public.smartcore_flexi_community_posts
  FOR INSERT WITH CHECK (author_client_id = public.flexi_current_client_id() AND company_id = public.flexi_client_company_id());

CREATE TABLE IF NOT EXISTS public.smartcore_flexi_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  metric_label text NOT NULL DEFAULT 'Points',
  start_date   date NOT NULL DEFAULT current_date,
  end_date     date,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.smartcore_flexi_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_challenges_staff ON public.smartcore_flexi_challenges
  FOR ALL USING (public.flexi_has_permission(company_id, 'flexi.manage_community'))
  WITH CHECK (public.flexi_has_permission(company_id, 'flexi.manage_community'));

CREATE POLICY smartcore_flexi_challenges_client_read ON public.smartcore_flexi_challenges
  FOR SELECT USING (company_id = public.flexi_client_company_id());

CREATE TABLE IF NOT EXISTS public.smartcore_flexi_challenge_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id  uuid NOT NULL REFERENCES public.smartcore_flexi_challenges(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES public.smartcore_flexi_clients(id) ON DELETE CASCADE,
  value         numeric NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(challenge_id, client_id)
);

ALTER TABLE public.smartcore_flexi_challenge_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_challenge_entries_read ON public.smartcore_flexi_challenge_entries
  FOR SELECT USING (
    challenge_id IN (
      SELECT ch.id FROM public.smartcore_flexi_challenges ch
      WHERE ch.company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
         OR ch.company_id = public.flexi_client_company_id()
    )
  );

CREATE POLICY smartcore_flexi_challenge_entries_client_write ON public.smartcore_flexi_challenge_entries
  FOR ALL USING (client_id = public.flexi_current_client_id())
  WITH CHECK (client_id = public.flexi_current_client_id());

CREATE POLICY smartcore_flexi_challenge_entries_staff_write ON public.smartcore_flexi_challenge_entries
  FOR ALL USING (
    challenge_id IN (SELECT ch.id FROM public.smartcore_flexi_challenges ch WHERE public.flexi_has_permission(ch.company_id, 'flexi.manage_community'))
  ) WITH CHECK (
    challenge_id IN (SELECT ch.id FROM public.smartcore_flexi_challenges ch WHERE public.flexi_has_permission(ch.company_id, 'flexi.manage_community'))
  );
