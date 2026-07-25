-- ============================================================================
-- SmartCore SiteSnap — Web Push subscriptions
-- One row per browser/device a person has granted push permission on (they
-- can have several — phone, laptop, etc.). Populated by
-- functions/api/sitesnap/push-subscribe.js after the client subscribes via
-- the Push API; consumed by functions/api/sitesnap/send-push.js, which uses
-- the service role to read across employees (a sender looks up the
-- recipient's subscriptions, not their own).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sitesnap_push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS sitesnap_push_subscriptions_employee_idx ON public.sitesnap_push_subscriptions(employee_id);

ALTER TABLE public.sitesnap_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitesnap_push_subscriptions_select_own ON public.sitesnap_push_subscriptions
  FOR SELECT USING (employee_id = public.sitesnap_current_employee_id(company_id));

CREATE POLICY sitesnap_push_subscriptions_delete_own ON public.sitesnap_push_subscriptions
  FOR DELETE USING (employee_id = public.sitesnap_current_employee_id(company_id));

-- Inserts/updates go through push-subscribe.js using the service role (it
-- upserts on the unique endpoint, which a plain "insert own row" policy
-- can't express cleanly) — no client-side INSERT policy is needed or granted.
