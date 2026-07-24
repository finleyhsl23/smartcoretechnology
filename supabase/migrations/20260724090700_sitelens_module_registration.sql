-- ============================================================================
-- SmartCore SiteLens — Migration 8: Marketplace registration
-- Registered as 'draft' so it does not appear in the public shop until it's
-- reviewed and explicitly flipped to 'published' — same rollout pattern used
-- for Presence & Fire Safety at launch.
-- ============================================================================

INSERT INTO public.marketplace_modules (
  slug, name, category, short_description, long_description, features,
  monthly_price, yearly_price, status, is_flat_rate
) VALUES (
  'sitelens',
  'SiteLens',
  'Operations',
  'GPS and timestamp-tagged job-site photo & video documentation, organised by project, with checklists, daily logs and task assignment.',
  'A full job-site documentation system: capture photos and videos straight from the browser with automatic GPS and timestamp tagging, organise everything by project, and keep the whole crew aligned. Includes project checklists with photo evidence, daily logs, task assignment, tagging, photo annotation and comment threads, per-project team access, and an integrations surface (outbound webhooks + a read-only export API key) for connecting SiteLens to other tools.',
  '["GPS & timestamp-tagged photo/video capture","Project-based organisation","Checklists with photo evidence","Daily logs","Task assignment","Tagging & photo annotation","Per-project team access","Outbound webhooks & API export","Full audit trail"]'::jsonb,
  0, 0, 'draft', false
)
ON CONFLICT (slug) DO NOTHING;
