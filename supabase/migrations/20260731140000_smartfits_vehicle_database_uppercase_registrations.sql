-- ============================================================================
-- Smartfits Vehicle Database — normalise existing registrations to all caps.
-- Going forward the app layer (createVehicle/updateVehicle/
-- addVehicleRegistration in shared/api.js) uppercases on write, but this
-- backfills the handful of rows already saved with mixed/lower case before
-- that was in place. Safe to run any time — it only changes casing, not
-- spacing, so registration_norm (already uppercase + space-stripped) is
-- unaffected and no unique-index collisions are possible.
-- ============================================================================

UPDATE smartfitsinstallationsltd.vdb_vehicles
SET registration = upper(registration)
WHERE registration <> upper(registration);

UPDATE smartfitsinstallationsltd.vdb_vehicle_registrations
SET registration = upper(registration)
WHERE registration <> upper(registration);
