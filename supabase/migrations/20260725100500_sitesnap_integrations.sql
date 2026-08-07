-- ============================================================================
-- SmartCore SiteSnap — Migration 6: Company settings, outbound webhooks,
-- and read-only API keys (the module's integration surface — a generic
-- webhook + API export rather than bespoke per-vendor OAuth, which no
-- module in this platform currently has infrastructure for).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sitesnap_settings (
  company_id        uuid PRIMARY KEY REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  notify_on_upload  boolean NOT NULL DEFAULT false,
  default_media_visibility text NOT NULL DEFAULT 'company' CHECK (default_media_visibility IN ('company', 'project_team')),
  updated_by        uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS sitesnap_settings_set_updated_at ON public.sitesnap_settings;
CREATE TRIGGER sitesnap_settings_set_updated_at BEFORE UPDATE ON public.sitesnap_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sitesnap_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitesnap_settings_select ON public.sitesnap_settings
  FOR SELECT USING (public.sitesnap_has_permission(company_id, 'sitesnap.view_projects'));

CREATE POLICY sitesnap_settings_write ON public.sitesnap_settings
  FOR ALL USING (public.sitesnap_has_permission(company_id, 'sitesnap.manage_settings'))
  WITH CHECK (public.sitesnap_has_permission(company_id, 'sitesnap.manage_settings'));

-- ----------------------------------------------------------------------------
-- Outbound webhooks — fired (via a Cloudflare Function, not a DB trigger —
-- this project has no pg_net/http extension wired up anywhere) after media
-- upload, checklist completion, and task completion.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitesnap_webhooks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  label        text NOT NULL,
  target_url   text NOT NULL,
  event_types  text[] NOT NULL DEFAULT ARRAY['media.uploaded','checklist.completed','task.completed'],
  secret       text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_fired_at timestamptz,
  last_status  text
);
CREATE INDEX IF NOT EXISTS sitesnap_webhooks_company_idx ON public.sitesnap_webhooks(company_id) WHERE is_active;

ALTER TABLE public.sitesnap_webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitesnap_webhooks_select ON public.sitesnap_webhooks
  FOR SELECT USING (public.sitesnap_has_permission(company_id, 'sitesnap.manage_settings'));

CREATE POLICY sitesnap_webhooks_write ON public.sitesnap_webhooks
  FOR ALL USING (public.sitesnap_has_permission(company_id, 'sitesnap.manage_settings'))
  WITH CHECK (public.sitesnap_has_permission(company_id, 'sitesnap.manage_settings'));

-- ----------------------------------------------------------------------------
-- API keys — read-only export access for external tools. Only a salted hash
-- is stored; the raw key is shown once at creation time (see settings.html /
-- functions/api/sitesnap/create-api-key.js).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitesnap_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  label        text NOT NULL,
  key_prefix   text NOT NULL,
  key_hash     text NOT NULL,
  created_by   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sitesnap_api_keys_hash_idx ON public.sitesnap_api_keys(key_hash);
CREATE INDEX IF NOT EXISTS sitesnap_api_keys_company_idx ON public.sitesnap_api_keys(company_id);

ALTER TABLE public.sitesnap_api_keys ENABLE ROW LEVEL SECURITY;

-- Client never reads key_hash back out — selects are restricted to admins
-- for key management (label/last_used/revoke) and the hash column is simply
-- never selected by the app; the export function itself uses the service
-- role and bypasses RLS entirely (see functions/api/sitesnap/api-export.js).
CREATE POLICY sitesnap_api_keys_select ON public.sitesnap_api_keys
  FOR SELECT USING (public.sitesnap_has_permission(company_id, 'sitesnap.manage_settings'));

CREATE POLICY sitesnap_api_keys_insert ON public.sitesnap_api_keys
  FOR INSERT WITH CHECK (public.sitesnap_has_permission(company_id, 'sitesnap.manage_settings'));

CREATE POLICY sitesnap_api_keys_revoke ON public.sitesnap_api_keys
  FOR UPDATE USING (public.sitesnap_has_permission(company_id, 'sitesnap.manage_settings'))
  WITH CHECK (public.sitesnap_has_permission(company_id, 'sitesnap.manage_settings'));

CREATE POLICY sitesnap_api_keys_delete ON public.sitesnap_api_keys
  FOR DELETE USING (public.sitesnap_has_permission(company_id, 'sitesnap.manage_settings'));
