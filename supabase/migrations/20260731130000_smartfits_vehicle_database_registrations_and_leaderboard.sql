-- ============================================================================
-- Smartfits Vehicle Database — known registrations list + change-request
-- leaderboard.
--
-- vdb_vehicle_registrations: fleets are often bought as identical batches
-- (see the "same make/model/year" search fallback), so one vehicle profile
-- can end up covering several physical plates over time. This table is the
-- append-only log of every registration that's ever been associated with a
-- profile, who logged it, and when — seeded with the vehicle's own
-- registration at creation time, and backfilled here for vehicles that
-- already existed before this migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.vdb_vehicle_registrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        uuid NOT NULL REFERENCES smartfitsinstallationsltd.vdb_vehicles(id) ON DELETE CASCADE,
  registration      text NOT NULL,
  registration_norm text GENERATED ALWAYS AS (upper(regexp_replace(registration, '\s+', '', 'g'))) STORED,
  added_by          uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  added_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vdb_vehicle_registrations_norm_idx
  ON smartfitsinstallationsltd.vdb_vehicle_registrations(registration_norm);
CREATE INDEX IF NOT EXISTS vdb_vehicle_registrations_vehicle_idx
  ON smartfitsinstallationsltd.vdb_vehicle_registrations(vehicle_id, added_at);

ALTER TABLE smartfitsinstallationsltd.vdb_vehicle_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY vdb_vehicle_registrations_select ON smartfitsinstallationsltd.vdb_vehicle_registrations
  FOR SELECT USING (smartfitsinstallationsltd.vdb_current_employee_id() IS NOT NULL);

CREATE POLICY vdb_vehicle_registrations_write ON smartfitsinstallationsltd.vdb_vehicle_registrations
  FOR ALL USING (smartfitsinstallationsltd.vdb_is_manager())
  WITH CHECK (smartfitsinstallationsltd.vdb_is_manager());

-- Backfill: every vehicle that already exists gets its current registration
-- logged as the first entry, attributed to whoever created it.
INSERT INTO smartfitsinstallationsltd.vdb_vehicle_registrations (vehicle_id, registration, added_by, added_at)
SELECT id, registration, created_by, created_at
FROM smartfitsinstallationsltd.vdb_vehicles v
WHERE NOT EXISTS (
  SELECT 1 FROM smartfitsinstallationsltd.vdb_vehicle_registrations r WHERE r.vehicle_id = v.id
);

-- ============================================================================
-- Change-request leaderboard — ranks employees by how many vehicle change
-- requests they've submitted. A SECURITY DEFINER aggregate rather than a
-- plain query: vdb_edit_requests' own RLS only lets an employee see their
-- own requests (plus managers seeing everything), so a straight SELECT
-- can't power a leaderboard visible to everyone. This function exposes only
-- the count per employee — never the request content itself — to any
-- Smartfits employee.
-- ============================================================================

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.vdb_change_request_leaderboard()
RETURNS TABLE (employee_id uuid, request_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT r.requested_by, count(*)
  FROM smartfitsinstallationsltd.vdb_edit_requests r
  WHERE smartfitsinstallationsltd.vdb_current_employee_id() IS NOT NULL
  GROUP BY r.requested_by
  ORDER BY count(*) DESC;
$$;

REVOKE EXECUTE ON FUNCTION smartfitsinstallationsltd.vdb_change_request_leaderboard() FROM anon;
