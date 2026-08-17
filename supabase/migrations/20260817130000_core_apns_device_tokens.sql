-- ============================================================================
-- SmartCore — native iOS push device tokens (Apple Push Notification service)
-- Separate from core_push_subscriptions (standard Web Push, for browsers/
-- PWAs) — this holds raw APNs device tokens registered by the
-- Capacitor-wrapped iOS app (com.smartcoretechnology.app) via its native
-- @capacitor/push-notifications plugin. Populated by
-- functions/api/push-subscribe.js; sent to via functions/api/_apns.js.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.core_apns_device_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_token text NOT NULL UNIQUE,
  environment  text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS core_apns_device_tokens_auth_user_idx ON public.core_apns_device_tokens(auth_user_id);

ALTER TABLE public.core_apns_device_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY core_apns_device_tokens_select_own ON public.core_apns_device_tokens
  FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY core_apns_device_tokens_delete_own ON public.core_apns_device_tokens
  FOR DELETE USING (auth_user_id = auth.uid());

-- Inserts/updates go through push-subscribe.js using the service role —
-- no client-side INSERT policy is needed or granted.
