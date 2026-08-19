-- ============================================================================
-- SmartCore — platform-wide Web Push subscriptions
-- One row per browser/device a person has granted notification permission
-- on (they can have several — phone, laptop, etc.). This is deliberately
-- platform-level, not module-specific: any module's server-side Function can
-- send an alert to a signed-in user's devices via functions/api/_push.js.
-- Populated by functions/api/push-subscribe.js after the client subscribes
-- via the Push API (prompted from /modules/, see modules/index.html).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.core_push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,
  p256dh       text NOT NULL,
  auth         text NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS core_push_subscriptions_auth_user_idx ON public.core_push_subscriptions(auth_user_id);

ALTER TABLE public.core_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY core_push_subscriptions_select_own ON public.core_push_subscriptions
  FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY core_push_subscriptions_delete_own ON public.core_push_subscriptions
  FOR DELETE USING (auth_user_id = auth.uid());

-- Inserts/updates go through push-subscribe.js using the service role (it
-- upserts on the unique endpoint, which a plain "insert own row" policy
-- can't express cleanly) — no client-side INSERT policy is needed or granted.
