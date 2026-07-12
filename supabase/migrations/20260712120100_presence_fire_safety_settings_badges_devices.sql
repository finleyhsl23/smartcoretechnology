-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 2: Settings, badges, devices
-- ============================================================================

-- Company-wide defaults. One row per company.
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_settings (
  company_id                     uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  default_sign_in_method         text NOT NULL DEFAULT 'manual'
    CHECK (default_sign_in_method IN ('qr','manual','kiosk')),
  allow_manual_employee_lookup   boolean NOT NULL DEFAULT true,
  allow_employee_code_lookup     boolean NOT NULL DEFAULT true,
  visitor_photo_enabled          boolean NOT NULL DEFAULT false,
  contractor_management_enabled  boolean NOT NULL DEFAULT true,
  auto_sign_out_enabled          boolean NOT NULL DEFAULT false,
  auto_sign_out_time             time,
  evacuation_pin_hash            text,
  evacuation_unlock_duration_minutes integer NOT NULL DEFAULT 20 CHECK (evacuation_unlock_duration_minutes BETWEEN 1 AND 180),
  failed_pin_limit               integer NOT NULL DEFAULT 5 CHECK (failed_pin_limit BETWEEN 1 AND 20),
  failed_pin_lockout_minutes     integer NOT NULL DEFAULT 10 CHECK (failed_pin_lockout_minutes BETWEEN 1 AND 180),
  data_retention_days            integer NOT NULL DEFAULT 730 CHECK (data_retention_days BETWEEN 30 AND 3650),
  updated_by                     uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS pfs_settings_set_updated_at ON public.presence_fire_safety_settings;
CREATE TRIGGER pfs_settings_set_updated_at BEFORE UPDATE ON public.presence_fire_safety_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Per-site overrides. NULL column value = inherit the company default.
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_site_settings (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id                         uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  default_sign_in_method          text CHECK (default_sign_in_method IN ('qr','manual','kiosk')),
  auto_sign_out_enabled           boolean,
  auto_sign_out_time              time,
  evacuation_unlock_duration_minutes integer CHECK (evacuation_unlock_duration_minutes BETWEEN 1 AND 180),
  updated_by                      uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, site_id)
);

DROP TRIGGER IF EXISTS pfs_site_settings_set_updated_at ON public.presence_fire_safety_site_settings;
CREATE TRIGGER pfs_site_settings_set_updated_at BEFORE UPDATE ON public.presence_fire_safety_site_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- QR badges: an opaque, revocable token mapped to an employee. The token
-- itself carries no personal data — scanning it only ever resolves to a
-- server-verified lookup, never client-decoded fields.
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_badges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  badge_token   text NOT NULL UNIQUE,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  issued_by     uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pfs_badges_employee_idx ON public.presence_fire_safety_badges(employee_id);
CREATE INDEX IF NOT EXISTS pfs_badges_company_idx ON public.presence_fire_safety_badges(company_id);
-- Only one active badge per employee at a time
CREATE UNIQUE INDEX IF NOT EXISTS pfs_badges_one_active_per_employee
  ON public.presence_fire_safety_badges(employee_id) WHERE status = 'active';

-- Authorised kiosks/devices. device_token is an opaque secret issued at
-- registration and never re-displayed; a bare device id from the browser is
-- never treated as proof of authorisation.
CREATE TABLE IF NOT EXISTS public.presence_fire_safety_devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  site_id        uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  device_name    text NOT NULL,
  device_type    text NOT NULL DEFAULT 'kiosk' CHECK (device_type IN ('kiosk','handheld','desktop','other')),
  device_token_hash text NOT NULL UNIQUE,
  active         boolean NOT NULL DEFAULT true,
  last_seen_at   timestamptz,
  created_by     uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pfs_devices_site_idx ON public.presence_fire_safety_devices(site_id);
CREATE INDEX IF NOT EXISTS pfs_devices_company_idx ON public.presence_fire_safety_devices(company_id);

ALTER TABLE public.presence_fire_safety_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_fire_safety_site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_fire_safety_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_fire_safety_devices ENABLE ROW LEVEL SECURITY;

-- Settings: readable by any company member (drives client behaviour), the
-- PIN hash column is never selected by the client layer (enforced in the
-- API/service layer — RLS alone cannot hide a single column from SELECT *).
CREATE POLICY pfs_settings_select ON public.presence_fire_safety_settings
  FOR SELECT USING (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );
CREATE POLICY pfs_settings_write ON public.presence_fire_safety_settings
  FOR ALL USING (public.presence_fire_safety_has_permission(company_id, 'presence.manage_settings'))
  WITH CHECK (public.presence_fire_safety_has_permission(company_id, 'presence.manage_settings'));

CREATE POLICY pfs_site_settings_select ON public.presence_fire_safety_site_settings
  FOR SELECT USING (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );
CREATE POLICY pfs_site_settings_write ON public.presence_fire_safety_site_settings
  FOR ALL USING (public.presence_fire_safety_has_permission(company_id, 'presence.manage_settings'))
  WITH CHECK (public.presence_fire_safety_has_permission(company_id, 'presence.manage_settings'));

-- Badges: employees can see their own; badge managers can see/manage all in company.
CREATE POLICY pfs_badges_select ON public.presence_fire_safety_badges
  FOR SELECT USING (
    employee_id IN (SELECT ce.id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
    OR public.presence_fire_safety_has_permission(company_id, 'presence.manage_badges')
  );
CREATE POLICY pfs_badges_write ON public.presence_fire_safety_badges
  FOR ALL USING (public.presence_fire_safety_has_permission(company_id, 'presence.manage_badges'))
  WITH CHECK (public.presence_fire_safety_has_permission(company_id, 'presence.manage_badges'));

-- Devices: manageable by settings managers; readable by anyone who can view the live register (kiosk UIs use device tokens directly, not RLS).
CREATE POLICY pfs_devices_select ON public.presence_fire_safety_devices
  FOR SELECT USING (
    public.presence_fire_safety_has_permission(company_id, 'presence.manage_settings')
    OR public.presence_fire_safety_has_permission(company_id, 'presence.view_live_register')
  );
CREATE POLICY pfs_devices_write ON public.presence_fire_safety_devices
  FOR ALL USING (public.presence_fire_safety_has_permission(company_id, 'presence.manage_settings'))
  WITH CHECK (public.presence_fire_safety_has_permission(company_id, 'presence.manage_settings'));
