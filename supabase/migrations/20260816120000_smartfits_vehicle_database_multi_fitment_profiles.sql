-- A single registration can now have a separate profile per fitment type
-- (OBD Tracker / Lightfoot / 3 Wire Tracker-Camera), since wiring and
-- component locations genuinely differ by fitment even on the exact same
-- physical vehicle over its lifetime. Identity moves from "registration"
-- alone to "registration + fitment".

alter table smartfitsinstallationsltd.vdb_vehicles
  alter column fitment_type set not null;

drop index if exists smartfitsinstallationsltd.vdb_vehicles_registration_norm_idx;
create unique index vdb_vehicles_registration_fitment_idx
  on smartfitsinstallationsltd.vdb_vehicles (registration_norm, fitment_type);

-- The known-registrations log (fleet batches sharing one profile) mapped a
-- plate to exactly one vehicle_id before; now a plate can legitimately map
-- to several vehicle_ids, one per fitment profile, so uniqueness moves to
-- the (plate, profile) pair instead of the plate alone.
drop index if exists smartfitsinstallationsltd.vdb_vehicle_registrations_norm_idx;
create unique index vdb_vehicle_registrations_norm_vehicle_idx
  on smartfitsinstallationsltd.vdb_vehicle_registrations (registration_norm, vehicle_id);
create index vdb_vehicle_registrations_norm_lookup_idx
  on smartfitsinstallationsltd.vdb_vehicle_registrations (registration_norm);
