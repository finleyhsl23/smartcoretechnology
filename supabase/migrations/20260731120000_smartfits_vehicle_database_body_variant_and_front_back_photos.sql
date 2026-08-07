-- ============================================================================
-- Smartfits Vehicle Database — body variant (Standard/Facelift) + front/back
-- photos. The "Configure" wizard on the Add/Edit Vehicle form collects all
-- three together (variant, then a front photo, then a back photo) since a
-- facelift usually changes the front/rear styling — recording which variant
-- this is makes the photos meaningful on their own.
-- ============================================================================

ALTER TABLE smartfitsinstallationsltd.vdb_vehicles
  ADD COLUMN IF NOT EXISTS body_variant text CHECK (body_variant IN ('standard', 'facelift'));

ALTER TABLE smartfitsinstallationsltd.vdb_vehicle_photos
  DROP CONSTRAINT vdb_vehicle_photos_category_check;
ALTER TABLE smartfitsinstallationsltd.vdb_vehicle_photos
  ADD CONSTRAINT vdb_vehicle_photos_category_check CHECK (category IN (
    'ignition_wire', 'earth_point', 'airbag', 'adas_camera', 'dashcam_mounting',
    'tracker_mounting', 'general', 'front', 'back'
  ));

ALTER TABLE smartfitsinstallationsltd.vdb_edit_request_photos
  DROP CONSTRAINT vdb_edit_request_photos_category_check;
ALTER TABLE smartfitsinstallationsltd.vdb_edit_request_photos
  ADD CONSTRAINT vdb_edit_request_photos_category_check CHECK (category IN (
    'ignition_wire', 'earth_point', 'airbag', 'adas_camera', 'dashcam_mounting',
    'tracker_mounting', 'general', 'front', 'back'
  ));
