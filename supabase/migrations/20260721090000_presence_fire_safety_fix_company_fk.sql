-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 14: Fix company_id FK target
-- ----------------------------------------------------------------------------
-- Every company_id column in this module was wired to REFERENCES
-- public.companies(id) — a legacy table used only by Holiday Management and
-- the internal HQ admin panel. Real marketplace customers (provisioned via
-- /api/payment-complete and everything under /shop) get their
-- core_employees.company_id from public.smartcore_core_companies instead —
-- companies and company_modules both key off that table, not "companies".
-- Result: creating a site (or anything else) for any real customer failed
-- with "violates foreign key constraint ..._company_id_fkey" because their
-- company_id never existed in public.companies to begin with.
--
-- This repoints every FK below at public.smartcore_core_companies(id).
-- ============================================================================

ALTER TABLE public.sites
  DROP CONSTRAINT IF EXISTS sites_company_id_fkey,
  ADD CONSTRAINT sites_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.site_access
  DROP CONSTRAINT IF EXISTS site_access_company_id_fkey,
  ADD CONSTRAINT site_access_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_permission_grants
  DROP CONSTRAINT IF EXISTS presence_fire_safety_permission_grants_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_permission_grants_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_audit_logs
  DROP CONSTRAINT IF EXISTS presence_fire_safety_audit_logs_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_audit_logs_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_settings
  DROP CONSTRAINT IF EXISTS presence_fire_safety_settings_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_settings_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_site_settings
  DROP CONSTRAINT IF EXISTS presence_fire_safety_site_settings_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_site_settings_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_badges
  DROP CONSTRAINT IF EXISTS presence_fire_safety_badges_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_badges_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_devices
  DROP CONSTRAINT IF EXISTS presence_fire_safety_devices_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_devices_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_visitors
  DROP CONSTRAINT IF EXISTS presence_fire_safety_visitors_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_visitors_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_visitor_visits
  DROP CONSTRAINT IF EXISTS presence_fire_safety_visitor_visits_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_visitor_visits_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_contractors
  DROP CONSTRAINT IF EXISTS presence_fire_safety_contractors_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_contractors_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_contractor_visits
  DROP CONSTRAINT IF EXISTS presence_fire_safety_contractor_visits_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_contractor_visits_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_events
  DROP CONSTRAINT IF EXISTS presence_fire_safety_events_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_events_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_current_presence
  DROP CONSTRAINT IF EXISTS presence_fire_safety_current_presence_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_current_presence_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_evacuation_sessions
  DROP CONSTRAINT IF EXISTS presence_fire_safety_evacuation_sessions_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_evacuation_sessions_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_evacuation_people
  DROP CONSTRAINT IF EXISTS presence_fire_safety_evacuation_people_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_evacuation_people_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_evacuation_pin_attempts
  DROP CONSTRAINT IF EXISTS presence_fire_safety_evacuation_pin_attempts_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_evacuation_pin_attempts_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_evacuation_unlocks
  DROP CONSTRAINT IF EXISTS presence_fire_safety_evacuation_unlocks_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_evacuation_unlocks_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;

ALTER TABLE public.presence_fire_safety_kiosk_pin_attempts
  DROP CONSTRAINT IF EXISTS presence_fire_safety_kiosk_pin_attempts_company_id_fkey,
  ADD CONSTRAINT presence_fire_safety_kiosk_pin_attempts_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE;
