-- ============================================================================
-- SmartCore SiteSnap — first-sign-in onboarding tracking
-- One row per employee, written once they finish (or skip past the demo
-- portion of) the welcome/permissions/demo tour. Row existing = never shown
-- again for that person, regardless of which device/browser they use next —
-- deliberately server-tracked rather than localStorage so clearing browser
-- data or signing in elsewhere doesn't re-trigger it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sitesnap_onboarding_state (
  employee_id  uuid PRIMARY KEY REFERENCES public.core_employees(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  location_permission text CHECK (location_permission IN ('granted', 'denied', 'skipped')),
  camera_permission   text CHECK (camera_permission IN ('granted', 'denied', 'skipped')),
  demo_skipped boolean NOT NULL DEFAULT false,
  completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sitesnap_onboarding_state_company_idx ON public.sitesnap_onboarding_state(company_id);

ALTER TABLE public.sitesnap_onboarding_state ENABLE ROW LEVEL SECURITY;

-- Each person can only ever see/write their own row — this is a personal
-- "have I done this" flag, not company-shared state.
CREATE POLICY sitesnap_onboarding_state_select_own ON public.sitesnap_onboarding_state
  FOR SELECT USING (employee_id = public.sitesnap_current_employee_id(company_id));

CREATE POLICY sitesnap_onboarding_state_insert_own ON public.sitesnap_onboarding_state
  FOR INSERT WITH CHECK (employee_id = public.sitesnap_current_employee_id(company_id));

-- Admins can see completion across the company (useful for support/rollout
-- visibility) but never write on someone else's behalf.
CREATE POLICY sitesnap_onboarding_state_select_admin ON public.sitesnap_onboarding_state
  FOR SELECT USING (
    company_id IN (
      SELECT ce.company_id FROM public.core_employees ce
      WHERE ce.auth_user_id = auth.uid() AND ce.role IN ('owner', 'admin', 'administrator')
    )
  );
