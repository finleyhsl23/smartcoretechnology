-- ============================================================================
-- SmartCore SiteSnap — Per-project "hide measurements" switch on a floor
-- plan. Stored on the floor plan itself (one per project) rather than per
-- level or per viewer, since it's meant to hide dimension labels for
-- everyone looking at that project's plan, not a personal display
-- preference. Editable by Owners/Admins only (same write policy as the
-- rest of the floor plan), visible to anyone who can view the plan.
-- ============================================================================

ALTER TABLE public.sitesnap_floor_plans
  ADD COLUMN IF NOT EXISTS hide_measurements boolean NOT NULL DEFAULT false;
