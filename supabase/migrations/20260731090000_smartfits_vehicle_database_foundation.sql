-- ============================================================================
-- Smartfits Installations Ltd — Vehicle Database module
-- Tables live in the smartfitsinstallationsltd schema (vdb_ prefix), same
-- tenant-schema convention as the audit_ tables used by the Engineer Install
-- Audit module. Identity is public.core_employees, same as every other
-- Smartfits module — NOT the legacy smartfitsinstallationsltd.employees table.
--
-- This schema is provably single-tenant (Smartfits only), so the company_id
-- is hardcoded into the helper functions below, same pattern as audit_company_id().
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper functions
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.vdb_company_id()
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT '34c3dc62-25dc-4159-b159-ae7b24479bee'::uuid;
$$;

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.vdb_current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT ce.id FROM public.core_employees ce
  WHERE ce.auth_user_id = auth.uid()
    AND ce.company_id = smartfitsinstallationsltd.vdb_company_id()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.vdb_is_owner_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.core_employees ce
    WHERE ce.auth_user_id = auth.uid()
      AND ce.company_id = smartfitsinstallationsltd.vdb_company_id()
      AND ce.role IN ('owner', 'admin')
  );
$$;

-- ----------------------------------------------------------------------------
-- vdb_settings — singleton row holding the Senior Regional Engineering
-- Manager roster, picked by Owner/Admin on the module's Settings page.
-- Membership here (or being Owner/Admin) is the "manager" tier: full add/
-- edit rights on vehicles plus the ability to review edit requests.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.vdb_settings (
  id                  uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  manager_employee_ids uuid[] NOT NULL DEFAULT '{}',
  updated_by          uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO smartfitsinstallationsltd.vdb_settings (id) VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE smartfitsinstallationsltd.vdb_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY vdb_settings_select ON smartfitsinstallationsltd.vdb_settings
  FOR SELECT USING (smartfitsinstallationsltd.vdb_current_employee_id() IS NOT NULL);

CREATE POLICY vdb_settings_write_admin ON smartfitsinstallationsltd.vdb_settings
  FOR ALL USING (smartfitsinstallationsltd.vdb_is_owner_or_admin())
  WITH CHECK (smartfitsinstallationsltd.vdb_is_owner_or_admin());

-- "manager" tier = Owner/Admin, or curated on the roster above.
CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.vdb_is_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT smartfitsinstallationsltd.vdb_is_owner_or_admin() OR EXISTS (
    SELECT 1 FROM smartfitsinstallationsltd.vdb_settings s
    WHERE s.id = '00000000-0000-0000-0000-000000000001'
      AND smartfitsinstallationsltd.vdb_current_employee_id() = ANY(s.manager_employee_ids)
  );
$$;

-- ----------------------------------------------------------------------------
-- vdb_vehicles — one row per installed vehicle profile.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.vdb_vehicles (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  registration                text NOT NULL,
  vin                         text,
  make                        text,
  model                       text,
  year_of_manufacture         integer,
  colour                      text,
  fuel_type                   text,

  -- Raw DVLA Vehicle Enquiry Service response, kept for reference/audit.
  -- DVLA does not return model, ignition wiring, or any install-specific
  -- data below — those are always entered/maintained by hand.
  dvla_raw                    jsonb,
  dvla_looked_up_at           timestamptz,

  -- Install reference data (the actual point of this module)
  ignition_wire_colour        text,
  ignition_wire_location      text,
  fuse_tap_options            text,
  can_high_colour             text,
  can_low_colour              text,
  earth_point_location        text,
  airbag_location             text,
  adas_camera_position        text,
  dashcam_mounting_location   text,
  tracker_mounting_location   text,
  installation_time           text,
  special_notes                text,

  created_by                  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  updated_by                  uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Normalised (uppercase, no spaces) registration is the canonical lookup key.
-- Enforced as a generated column rather than trusting callers to normalise.
ALTER TABLE smartfitsinstallationsltd.vdb_vehicles
  ADD COLUMN IF NOT EXISTS registration_norm text
  GENERATED ALWAYS AS (upper(regexp_replace(registration, '\s+', '', 'g'))) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS vdb_vehicles_registration_norm_idx
  ON smartfitsinstallationsltd.vdb_vehicles(registration_norm);

CREATE UNIQUE INDEX IF NOT EXISTS vdb_vehicles_vin_idx
  ON smartfitsinstallationsltd.vdb_vehicles(vin) WHERE vin IS NOT NULL AND vin <> '';

CREATE INDEX IF NOT EXISTS vdb_vehicles_make_model_idx ON smartfitsinstallationsltd.vdb_vehicles(make, model);

DROP TRIGGER IF EXISTS vdb_vehicles_set_updated_at ON smartfitsinstallationsltd.vdb_vehicles;
CREATE TRIGGER vdb_vehicles_set_updated_at BEFORE UPDATE ON smartfitsinstallationsltd.vdb_vehicles
  FOR EACH ROW EXECUTE FUNCTION smartfitsinstallationsltd.set_updated_at();

ALTER TABLE smartfitsinstallationsltd.vdb_vehicles ENABLE ROW LEVEL SECURITY;

-- Every Smartfits employee can view every vehicle — this is a shared
-- install-reference database, not scoped to who added it.
CREATE POLICY vdb_vehicles_select ON smartfitsinstallationsltd.vdb_vehicles
  FOR SELECT USING (smartfitsinstallationsltd.vdb_current_employee_id() IS NOT NULL);

CREATE POLICY vdb_vehicles_insert ON smartfitsinstallationsltd.vdb_vehicles
  FOR INSERT WITH CHECK (smartfitsinstallationsltd.vdb_is_manager());

CREATE POLICY vdb_vehicles_update ON smartfitsinstallationsltd.vdb_vehicles
  FOR UPDATE USING (smartfitsinstallationsltd.vdb_is_manager())
  WITH CHECK (smartfitsinstallationsltd.vdb_is_manager());

-- Deletion is Owner/Admin only — a stricter bar than the direct-edit right
-- Senior Regional Engineering Managers get, since removing a vehicle profile
-- outright is harder to undo than an edit.
CREATE POLICY vdb_vehicles_delete ON smartfitsinstallationsltd.vdb_vehicles
  FOR DELETE USING (smartfitsinstallationsltd.vdb_is_owner_or_admin());

-- ----------------------------------------------------------------------------
-- vdb_vehicle_photos — approved photos attached directly to a vehicle,
-- grouped by category (ignition wire, earth point, airbag, ADAS camera,
-- dashcam mount, tracker mount, or general/misc).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.vdb_vehicle_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES smartfitsinstallationsltd.vdb_vehicles(id) ON DELETE CASCADE,
  category      text NOT NULL CHECK (category IN (
                  'ignition_wire', 'earth_point', 'airbag', 'adas_camera',
                  'dashcam_mounting', 'tracker_mounting', 'general'
                )),
  storage_path  text NOT NULL,
  caption       text,
  uploaded_by   uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vdb_vehicle_photos_vehicle_idx ON smartfitsinstallationsltd.vdb_vehicle_photos(vehicle_id, category);

ALTER TABLE smartfitsinstallationsltd.vdb_vehicle_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY vdb_vehicle_photos_select ON smartfitsinstallationsltd.vdb_vehicle_photos
  FOR SELECT USING (smartfitsinstallationsltd.vdb_current_employee_id() IS NOT NULL);

CREATE POLICY vdb_vehicle_photos_write ON smartfitsinstallationsltd.vdb_vehicle_photos
  FOR ALL USING (smartfitsinstallationsltd.vdb_is_manager())
  WITH CHECK (smartfitsinstallationsltd.vdb_is_manager());

-- ----------------------------------------------------------------------------
-- vdb_edit_requests — a normal employee's proposed full-profile change to an
-- existing vehicle, awaiting a Senior Regional Engineering Manager (or
-- Owner/Admin) to approve or deny. proposed_changes only carries the fields
-- that actually changed (a JSON patch), diffed client-side against the
-- vehicle's current values, so the reviewer sees a precise before/after.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.vdb_edit_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        uuid NOT NULL REFERENCES smartfitsinstallationsltd.vdb_vehicles(id) ON DELETE CASCADE,
  requested_by      uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  proposed_changes  jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_note      text,
  reviewed_by       uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  review_note       text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vdb_edit_requests_vehicle_idx ON smartfitsinstallationsltd.vdb_edit_requests(vehicle_id);
CREATE INDEX IF NOT EXISTS vdb_edit_requests_status_idx ON smartfitsinstallationsltd.vdb_edit_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS vdb_edit_requests_requester_idx ON smartfitsinstallationsltd.vdb_edit_requests(requested_by);

-- Once reviewed, a request is locked — re-review must happen as a fresh
-- request, mirroring how submitted audits are locked in the Engineer Install
-- Audit module. Also stamps reviewed_at the moment status leaves 'pending'.
CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.vdb_edit_requests_lock_reviewed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_temp
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been reviewed and cannot be changed.';
  END IF;
  IF NEW.status <> 'pending' AND NEW.reviewed_at IS NULL THEN
    NEW.reviewed_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vdb_edit_requests_lock_reviewed_trg ON smartfitsinstallationsltd.vdb_edit_requests;
CREATE TRIGGER vdb_edit_requests_lock_reviewed_trg BEFORE UPDATE ON smartfitsinstallationsltd.vdb_edit_requests
  FOR EACH ROW EXECUTE FUNCTION smartfitsinstallationsltd.vdb_edit_requests_lock_reviewed();

ALTER TABLE smartfitsinstallationsltd.vdb_edit_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY vdb_edit_requests_select ON smartfitsinstallationsltd.vdb_edit_requests
  FOR SELECT USING (
    smartfitsinstallationsltd.vdb_is_manager()
    OR requested_by = smartfitsinstallationsltd.vdb_current_employee_id()
  );

CREATE POLICY vdb_edit_requests_insert ON smartfitsinstallationsltd.vdb_edit_requests
  FOR INSERT WITH CHECK (
    requested_by = smartfitsinstallationsltd.vdb_current_employee_id()
    AND status = 'pending'
  );

-- Only a manager/admin may transition status (approve/deny); the lock
-- trigger above stops them (or anyone) editing an already-reviewed row.
CREATE POLICY vdb_edit_requests_update ON smartfitsinstallationsltd.vdb_edit_requests
  FOR UPDATE USING (smartfitsinstallationsltd.vdb_is_manager())
  WITH CHECK (smartfitsinstallationsltd.vdb_is_manager());

-- A requester can withdraw their own request while it's still pending;
-- Owner/Admin can also remove one (e.g. cleaning up a stale/duplicate).
CREATE POLICY vdb_edit_requests_delete ON smartfitsinstallationsltd.vdb_edit_requests
  FOR DELETE USING (
    (status = 'pending' AND requested_by = smartfitsinstallationsltd.vdb_current_employee_id())
    OR smartfitsinstallationsltd.vdb_is_owner_or_admin()
  );

-- ----------------------------------------------------------------------------
-- vdb_edit_request_photos — new photos proposed as part of an edit request.
-- Stored under storage path 'pending/<request_id>/<file>' until approved, at
-- which point the app moves the object to '<vehicle_id>/<file>' and inserts
-- the corresponding vdb_vehicle_photos row.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.vdb_edit_request_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES smartfitsinstallationsltd.vdb_edit_requests(id) ON DELETE CASCADE,
  category      text NOT NULL CHECK (category IN (
                  'ignition_wire', 'earth_point', 'airbag', 'adas_camera',
                  'dashcam_mounting', 'tracker_mounting', 'general'
                )),
  storage_path  text NOT NULL,
  caption       text,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vdb_edit_request_photos_request_idx ON smartfitsinstallationsltd.vdb_edit_request_photos(request_id);

ALTER TABLE smartfitsinstallationsltd.vdb_edit_request_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY vdb_edit_request_photos_select ON smartfitsinstallationsltd.vdb_edit_request_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.vdb_edit_requests r
      WHERE r.id = vdb_edit_request_photos.request_id
        AND (smartfitsinstallationsltd.vdb_is_manager() OR r.requested_by = smartfitsinstallationsltd.vdb_current_employee_id())
    )
  );

CREATE POLICY vdb_edit_request_photos_insert ON smartfitsinstallationsltd.vdb_edit_request_photos
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.vdb_edit_requests r
      WHERE r.id = vdb_edit_request_photos.request_id
        AND r.status = 'pending'
        AND r.requested_by = smartfitsinstallationsltd.vdb_current_employee_id()
    )
  );

-- Requester can remove their own proposed photo while still pending;
-- manager/admin can clean up regardless of status (e.g. after a deny).
CREATE POLICY vdb_edit_request_photos_delete ON smartfitsinstallationsltd.vdb_edit_request_photos
  FOR DELETE USING (
    smartfitsinstallationsltd.vdb_is_manager()
    OR EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.vdb_edit_requests r
      WHERE r.id = vdb_edit_request_photos.request_id
        AND r.status = 'pending'
        AND r.requested_by = smartfitsinstallationsltd.vdb_current_employee_id()
    )
  );

-- Approval applies the JSON patch + re-parents photos, all under the
-- requesting manager's own write rights — no elevated RPC required since
-- vdb_is_manager() already grants direct UPDATE on vdb_vehicles and INSERT
-- on vdb_vehicle_photos.
