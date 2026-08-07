-- ============================================================================
-- Smartfits Vehicle Database — let employees suggest brand new vehicles.
--
-- Previously only a Senior Regional Engineering Manager (or Owner/Admin)
-- could create a vehicle at all (vdb_vehicles_insert requires
-- vdb_is_manager()). An employee who searched a reg/make/model/year that
-- wasn't on file had no option but to ask a manager to add it by hand.
--
-- This reuses the existing vdb_edit_requests table (rather than a new one)
-- with a new request_type: 'new_vehicle' requests carry the full proposed
-- vehicle in proposed_changes and have no vehicle_id yet (nothing exists to
-- attach to until a manager approves). vdb_edit_request_photos already keys
-- off request_id, not vehicle_id, so staged photos for a new-vehicle
-- suggestion need no schema change at all.
-- ============================================================================

ALTER TABLE smartfitsinstallationsltd.vdb_edit_requests
  ALTER COLUMN vehicle_id DROP NOT NULL;

ALTER TABLE smartfitsinstallationsltd.vdb_edit_requests
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'edit'
    CHECK (request_type IN ('edit', 'new_vehicle'));
