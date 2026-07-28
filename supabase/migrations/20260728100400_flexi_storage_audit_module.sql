-- ============================================================================
-- SmartCore Flexi — Migration 5: Storage, audit log, marketplace
-- registration, demo grant, anon-execute hardening
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Private media bucket — progress photos, exercise videos/thumbnails, chat
-- attachments. Never public: everything is customer/client health data.
-- Path convention:
--   Client-owned content: <company_id>/<client_id>/<category>/<filename>
--   Exercise library media: <company_id>/exercises/<exercise_id>/<filename>
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'flexi-media',
  'flexi-media',
  false,
  209715200,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime','video/webm']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY flexi_media_client_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'flexi-media'
    AND split_part(name, '/', 2) = (public.flexi_current_client_id())::text
  );

CREATE POLICY flexi_media_client_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'flexi-media'
    AND split_part(name, '/', 2) = (public.flexi_current_client_id())::text
    AND split_part(name, '/', 1) = (public.flexi_client_company_id())::text
  );

CREATE POLICY flexi_media_client_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'flexi-media'
    AND split_part(name, '/', 2) = (public.flexi_current_client_id())::text
  );

CREATE POLICY flexi_media_staff_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'flexi-media'
    AND public.flexi_has_permission((split_part(name, '/', 1))::uuid, 'flexi.view_clients')
  );

CREATE POLICY flexi_media_staff_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'flexi-media'
    AND (
      (split_part(name, '/', 2) = 'exercises' AND public.flexi_has_permission((split_part(name, '/', 1))::uuid, 'flexi.manage_exercises'))
      OR public.flexi_has_permission((split_part(name, '/', 1))::uuid, 'flexi.manage_clients')
    )
  );

CREATE POLICY flexi_media_staff_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'flexi-media'
    AND (
      (split_part(name, '/', 2) = 'exercises' AND public.flexi_has_permission((split_part(name, '/', 1))::uuid, 'flexi.manage_exercises'))
      OR public.flexi_has_permission((split_part(name, '/', 1))::uuid, 'flexi.manage_clients')
    )
  );

-- ----------------------------------------------------------------------------
-- Audit log — Enterprise-tier feature. Append-only: no UPDATE/DELETE policy.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.smartcore_flexi_audit_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  actor_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  action            text NOT NULL,
  entity_type       text NOT NULL,
  entity_id         uuid,
  meta              jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS smartcore_flexi_audit_logs_company_idx ON public.smartcore_flexi_audit_logs(company_id, created_at DESC);

ALTER TABLE public.smartcore_flexi_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY smartcore_flexi_audit_logs_select ON public.smartcore_flexi_audit_logs
  FOR SELECT USING (public.flexi_has_permission(company_id, 'flexi.view_audit_log'));

CREATE POLICY smartcore_flexi_audit_logs_insert ON public.smartcore_flexi_audit_logs
  FOR INSERT WITH CHECK (
    company_id IN (SELECT ce.company_id FROM public.core_employees ce WHERE ce.auth_user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Marketplace registration — draft until reviewed, same rollout pattern as
-- SiteStamp/SiteSnap at launch.
-- ----------------------------------------------------------------------------
INSERT INTO public.marketplace_modules (
  slug, name, category, short_description, long_description, features,
  monthly_price, yearly_price, status, is_flat_rate
) VALUES (
  'flexi',
  'Flexi',
  'Fitness & Coaching',
  'Personal training and gym coaching software — client programs, booking, nutrition, progress tracking and payments, with no per-client pricing.',
  'Flexi is a full personal-training and gym-coaching platform: client profiles, a workout builder backed by a video exercise library, session and class booking, in-app messaging, nutrition and macro tracking, automated check-ins and habit coaching, progress tracking with photos and measurements, session packages and payment recording, digital waivers, and — for multi-trainer studios — staff accounts, group classes, a branded client app, community challenges, multi-location support and fire-safety compliance tie-ins. Every tier includes unlimited clients, billed in GBP, with a 12-month committed-monthly billing option alongside standard flexible monthly and annual plans.',
  '["Unlimited clients on every tier","Workout & program builder with video exercise library","Session & class booking calendar","In-app client messaging","Nutrition & macro tracking","Automated check-ins & habit coaching","Progress tracking — photos, measurements, PRs","Packages, recurring billing & payment recording","Digital waivers & PAR-Q forms","Multi-trainer staff accounts","Group classes & community challenges","Multi-location & compliance tie-ins (Enterprise)"]'::jsonb,
  14.99, 134.91, 'draft', false
)
ON CONFLICT (slug) DO NOTHING;
-- Note: Flexi's four tiers (Starter/Pro/Business/Enterprise) and the Flex /
-- Committed-12mo / Annual-Prepay billing options are gated in-app via
-- systems/flexi/shared/auth.js TIER_FEATURES, the same pattern SmartCore CRM
-- uses — this single marketplace_modules row lists the Starter entry price;
-- it does not attempt to replicate CRM's multi-row tier-grouping shop UI.

-- ----------------------------------------------------------------------------
-- Grant access to SmartCore Technology LTD for internal QA/demo, mirroring
-- the SiteStamp/SiteSnap internal-grant pattern. Neither table has a unique
-- constraint on (company_id, module_slug/module_key), so idempotency is
-- guarded explicitly.
-- ----------------------------------------------------------------------------
INSERT INTO public.smartcore_core_purchased_modules (company_id, module_slug, module_name, billing_type, status)
SELECT 'b9298a9b-a910-4ba9-9a57-72db43b3b3d7', 'flexi', 'Flexi', 'monthly', 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.smartcore_core_purchased_modules
  WHERE company_id = 'b9298a9b-a910-4ba9-9a57-72db43b3b3d7' AND module_slug = 'flexi'
);

INSERT INTO public.company_modules (company_id, module_key, enabled, tier)
SELECT 'b9298a9b-a910-4ba9-9a57-72db43b3b3d7', 'flexi', true, 'enterprise'
WHERE NOT EXISTS (
  SELECT 1 FROM public.company_modules
  WHERE company_id = 'b9298a9b-a910-4ba9-9a57-72db43b3b3d7' AND module_key = 'flexi'
);

-- ----------------------------------------------------------------------------
-- Revoke anon EXECUTE — Supabase's implicit anon grant at function-creation
-- time survives a plain REVOKE ALL FROM PUBLIC, so close it explicitly as
-- defense-in-depth (mirrors 20260712120900 / sitesnap's equivalent pass).
-- flexi_get_invite is intentionally excluded — it's the one legitimate
-- unauthenticated flow (a prospective client has no session yet).
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.flexi_default_permissions(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.flexi_current_employee(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.flexi_current_employee_id(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.flexi_has_permission(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.flexi_is_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.flexi_module_enabled(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.flexi_my_permissions(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.flexi_current_client() FROM anon;
REVOKE EXECUTE ON FUNCTION public.flexi_current_client_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.flexi_accept_invite(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.flexi_client_company_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.flexi_book_class(uuid, uuid) FROM anon;
