-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 5: Marketplace registration
-- ============================================================================

INSERT INTO public.marketplace_modules (
  slug, name, category, short_description, long_description, features,
  monthly_price, yearly_price, status, is_flat_rate
) VALUES (
  'presence-and-fire-safety',
  'Presence & Fire Safety',
  'Operations',
  'Live workplace presence, visitor and contractor management, and PIN-protected fire evacuation roll call.',
  'A full workplace presence-management and emergency roll-call system: QR badge and manual sign-in/out for employees, visitor and contractor registers, a live onsite view per site, and a secure PIN-protected evacuation workflow with real-time roll call, reporting and CSV export.',
  '["QR badge & manual sign-in/out","Live onsite register","Visitor & contractor management","Multi-site support","PIN-protected fire evacuation roll call","Reporting & CSV export","Full audit trail"]'::jsonb,
  0, 0, 'draft', false
)
ON CONFLICT (slug) DO NOTHING;
