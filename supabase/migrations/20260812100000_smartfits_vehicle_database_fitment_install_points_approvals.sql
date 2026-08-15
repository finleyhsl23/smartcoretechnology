-- ============================================================================
-- Smartfits Vehicle Database — fitment type, install points, and an
-- approval leaderboard.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Fitment type — OBD Tracker / Lightfoot / 3 Wire Tracker-Camera. Wiring and
-- component locations genuinely differ by what's being fitted, the same way
-- they differ by Body Variant, so this is required at creation the same way
-- (enforced in the app, nullable here so existing rows aren't broken), and
-- searchable alongside make/model/year.
-- ----------------------------------------------------------------------------
ALTER TABLE smartfitsinstallationsltd.vdb_vehicles
  ADD COLUMN IF NOT EXISTS fitment_type text
    CHECK (fitment_type IN ('obd_tracker', 'lightfoot', 'three_wire_tracker_camera'));

-- ----------------------------------------------------------------------------
-- vdb_install_points — some vehicles have more than one pickup/mounting
-- point (e.g. a second earth or ignition feed elsewhere in the loom). Rather
-- than force those into the single fixed location fields, this is a free-form
-- repeatable list: a label, a description, and photos, same direct-edit
-- permission model as everything else that touches an existing vehicle
-- (manager/admin write, everyone can view) — mirrors vdb_vehicle_registrations
-- exactly.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.vdb_install_points (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   uuid NOT NULL REFERENCES smartfitsinstallationsltd.vdb_vehicles(id) ON DELETE CASCADE,
  label        text NOT NULL,
  description  text,
  created_by   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vdb_install_points_vehicle_idx
  ON smartfitsinstallationsltd.vdb_install_points(vehicle_id, created_at);

ALTER TABLE smartfitsinstallationsltd.vdb_install_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY vdb_install_points_select ON smartfitsinstallationsltd.vdb_install_points
  FOR SELECT USING (smartfitsinstallationsltd.vdb_current_employee_id() IS NOT NULL);

CREATE POLICY vdb_install_points_write ON smartfitsinstallationsltd.vdb_install_points
  FOR ALL USING (smartfitsinstallationsltd.vdb_is_manager())
  WITH CHECK (smartfitsinstallationsltd.vdb_is_manager());

-- Photos for an install point. Stored under the same '<vehicle_id>/...'
-- storage path prefix as every other approved vehicle photo (just nested
-- under a 'points/<install_point_id>/' subpath for organisation) — the
-- existing storage.objects policies only ever look at the first path
-- segment, so this needs no new storage policy at all.
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.vdb_install_point_photos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  install_point_id  uuid NOT NULL REFERENCES smartfitsinstallationsltd.vdb_install_points(id) ON DELETE CASCADE,
  storage_path      text NOT NULL,
  uploaded_by       uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vdb_install_point_photos_point_idx
  ON smartfitsinstallationsltd.vdb_install_point_photos(install_point_id);

ALTER TABLE smartfitsinstallationsltd.vdb_install_point_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY vdb_install_point_photos_select ON smartfitsinstallationsltd.vdb_install_point_photos
  FOR SELECT USING (smartfitsinstallationsltd.vdb_current_employee_id() IS NOT NULL);

CREATE POLICY vdb_install_point_photos_write ON smartfitsinstallationsltd.vdb_install_point_photos
  FOR ALL USING (smartfitsinstallationsltd.vdb_is_manager())
  WITH CHECK (smartfitsinstallationsltd.vdb_is_manager());

-- ----------------------------------------------------------------------------
-- Approval leaderboard — ranks managers/admins by how many change requests
-- they've approved, so review workload doesn't quietly pile onto one person
-- (e.g. Ben approving everything while Dan approves nothing). Same
-- SECURITY DEFINER aggregate pattern as vdb_change_request_leaderboard:
-- vdb_edit_requests' own RLS only lets an employee see their own requests
-- (plus managers seeing everything), so this exposes only the count per
-- reviewer, never request content, to any Smartfits employee — the app
-- restricts who actually sees the resulting leaderboard to managers/admins.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.vdb_approval_leaderboard()
RETURNS TABLE (employee_id uuid, approval_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT r.reviewed_by, count(*)
  FROM smartfitsinstallationsltd.vdb_edit_requests r
  WHERE smartfitsinstallationsltd.vdb_current_employee_id() IS NOT NULL
    AND r.status = 'approved'
    AND r.reviewed_by IS NOT NULL
  GROUP BY r.reviewed_by
  ORDER BY count(*) DESC;
$$;

REVOKE EXECUTE ON FUNCTION smartfitsinstallationsltd.vdb_approval_leaderboard() FROM anon;
