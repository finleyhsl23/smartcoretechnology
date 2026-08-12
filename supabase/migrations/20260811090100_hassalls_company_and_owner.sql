-- ============================================================================
-- Hassalls — company record, private marketplace entry, owner account and
-- initial sites/ingestion keys.
--
-- Hassalls is not a commercial customer — it is a private/family entity
-- provisioned using the same company-record shape as every other tenant so
-- it behaves consistently with the rest of the platform (per-tenant module
-- gating, onboarding flow, etc.), while the marketplace catalog row stays
-- status='draft' + is_private=true so it never surfaces on /modules/ or the
-- public shop, mirroring the rollout pattern already used for Convoy and the
-- Smartfits Vehicle Database before going public.
--
-- IDs are hardcoded literals (not generated inline) so this migration is
-- idempotent to re-run and so the same IDs can be referenced from the
-- Cloudflare Worker / frontend constants, matching the pattern in
-- 20260730100900_convoy_grant_smartcore_technology_ltd.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Company record
-- ----------------------------------------------------------------------------
INSERT INTO public.smartcore_core_companies (
  id, company_name, company_email, status, access_status, billing_type
) VALUES (
  'a151f91a-e392-433c-af3a-0d1075ea777d',
  'Hassalls',
  'finley@hassalls.co.uk',
  'provisioned',
  'active',
  'monthly'
)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Marketplace catalog entry — kept private/draft so it's never listed.
-- ----------------------------------------------------------------------------
INSERT INTO public.marketplace_modules (
  slug, name, category, short_description, status, is_private, private_company_name, private_client_email
) VALUES (
  'private-surveillance',
  'Private Surveillance',
  'Security',
  'Private home/family security dashboard: camera status, AI-reviewed motion events, vehicle plate log and threat alerts.',
  'draft',
  true,
  'Hassalls',
  'finley@hassalls.co.uk'
)
ON CONFLICT (slug) DO NOTHING;

-- Entitlement rows — same two-table pattern as every other internal grant
-- (smartcore_core_purchased_modules drives the /modules/ tile query,
-- company_modules is the module's own internal gate). Neither is the actual
-- access control for this module — hassalls.is_allowed_user() is — but both
-- are populated for consistency with how the rest of the platform reasons
-- about "does this company have this module".
INSERT INTO public.smartcore_core_purchased_modules (company_id, module_slug, module_name, billing_type, status)
SELECT 'a151f91a-e392-433c-af3a-0d1075ea777d', 'private-surveillance', 'Private Surveillance', 'monthly', 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.smartcore_core_purchased_modules
  WHERE company_id = 'a151f91a-e392-433c-af3a-0d1075ea777d' AND module_slug = 'private-surveillance'
);

INSERT INTO public.company_modules (company_id, module_key, enabled)
VALUES ('a151f91a-e392-433c-af3a-0d1075ea777d', 'private-surveillance', true)
ON CONFLICT (company_id, module_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Owner account — core_employees row now (role='owner'), Supabase auth user
-- created when they complete onboarding via the standard token link (same
-- flow as functions/api/core/send-employee-invite.js +
-- systems/core/employee-onboarding.html used for every other employee).
-- ----------------------------------------------------------------------------
INSERT INTO public.core_employees (
  id, company_id, employee_id, full_name, work_email, personal_email, role, onboarding_completed
) VALUES (
  '2c9f9a4e-6b0a-4e2a-9a6a-3b7a1d1e9f01',
  'a151f91a-e392-433c-af3a-0d1075ea777d',
  'HAS988641238',
  'Finley',
  'finley@hassalls.co.uk',
  'finleyh123456@gmail.com',
  'owner',
  false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.core_onboarding_tokens (employee_id, token, email)
SELECT '2c9f9a4e-6b0a-4e2a-9a6a-3b7a1d1e9f01', 'ab26a5c8f475b96c6d86ee5f6b8f6de7a291ca31a916b4fc27b2e6a7c913042d', 'finley@hassalls.co.uk'
WHERE NOT EXISTS (
  SELECT 1 FROM public.core_onboarding_tokens WHERE token = 'ab26a5c8f475b96c6d86ee5f6b8f6de7a291ca31a916b4fc27b2e6a7c913042d'
);

-- ----------------------------------------------------------------------------
-- Explicit dashboard allow-list — the actual access gate. Add further family
-- members later with:
--   insert into hassalls.allowed_users (email, label) values ('name@example.com', 'label');
-- ----------------------------------------------------------------------------
INSERT INTO hassalls.allowed_users (email, label)
VALUES ('finley@hassalls.co.uk', 'Owner')
ON CONFLICT (email) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Initial sites
-- ----------------------------------------------------------------------------
INSERT INTO hassalls.sites (id, name) VALUES
  ('4cc3a7bc-e3c8-4e81-bb8c-a26b9953ca4d', 'House'),
  ('47336ae9-79ca-49cc-b982-f57b4a8d0f54', 'Storage Unit')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Per-site ingestion API keys for the Pi watcher script. Raw keys are shown
-- once, here, in this migration's commit — only the sha256 hash is ever
-- stored. Rotate by inserting a new row and setting revoked_at on the old
-- one; do not reuse a plate key across sites.
--   House:         hsc_2SgE_ni4QeLp9VywkaVJkBy0zw7K5Sg5-VzMR6ZTojQ
--   Storage Unit:  hsc_VkxxA68SPcm1HvoLEwpXKY_z_DQUrl9x6_yFC_0lUeQ
-- ----------------------------------------------------------------------------
INSERT INTO hassalls.ingestion_keys (site_id, label, key_prefix, key_hash) VALUES
  ('4cc3a7bc-e3c8-4e81-bb8c-a26b9953ca4d', 'House Pi watcher', 'hsc_2SgE', '0242f3ce9eb092aa77053b2c2dab19d765e695b6a7b7efcff5f052fce62201a6'),
  ('47336ae9-79ca-49cc-b982-f57b4a8d0f54', 'Storage Unit Pi watcher', 'hsc_VkxxA6', '03cb9414f6c60792addc08c41cc0659f0edf2af21cae1432764b8493bd271231')
ON CONFLICT (key_hash) DO NOTHING;
