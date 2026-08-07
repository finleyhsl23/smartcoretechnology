ALTER TABLE public.sitesnap_onboarding_state
  ADD COLUMN IF NOT EXISTS notifications_permission text
    CHECK (notifications_permission IN ('granted', 'denied', 'skipped'));
