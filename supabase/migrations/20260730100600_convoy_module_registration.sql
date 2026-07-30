-- ============================================================================
-- SmartCore Convoy — Migration 7: Marketplace registration
-- Registered as 'draft' so it does not appear in the public shop until it's
-- reviewed and explicitly flipped to 'published' — same rollout pattern used
-- for SiteSnap/SiteStamp at launch.
-- ============================================================================

INSERT INTO public.marketplace_modules (
  slug, name, category, short_description, long_description, features,
  monthly_price, yearly_price, status, is_flat_rate
) VALUES (
  'convoy',
  'Convoy',
  'Fleet',
  'GPS-verified daily vehicle checks, defect management and compliance tracking for your fleet.',
  'A complete vehicle check and defect management system: drivers complete a live-camera, GPS-tagged walkaround before taking a vehicle out, with every required zone photographed in person to prove the inspection actually happened on-site. Failed items automatically raise defects, off-road defects take a vehicle out of service immediately, and every check becomes a locked, exportable audit record. Includes a vehicle register with MOT/tax/insurance/service due-date tracking, driver licence checks with expiry reminders, configurable checklist templates per vehicle type, and a fleet dashboard showing what needs attention today.',
  '["GPS-verified live-camera walkaround checks","Automatic defect creation from failed items","Off-road defects take vehicles out of service","Locked, exportable audit trail per check","Vehicle register with MOT/tax/insurance/service tracking","Driver licence checks & expiry reminders","Configurable checklist templates per vehicle type","Geofenced depot location checks","Fleet dashboard"]'::jsonb,
  0, 0, 'draft', false
)
ON CONFLICT (slug) DO NOTHING;
