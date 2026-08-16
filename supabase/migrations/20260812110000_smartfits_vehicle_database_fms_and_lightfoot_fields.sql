-- ============================================================================
-- Smartfits Vehicle Database — FMS Plug Location (Wiring & Electrical), and
-- two Lightfoot-specific fields: Driver ID and B&P Button exact locations.
-- All three get their own photo category, same as the other location fields.
-- ============================================================================

ALTER TABLE smartfitsinstallationsltd.vdb_vehicles
  ADD COLUMN IF NOT EXISTS fms_plug_location text,
  ADD COLUMN IF NOT EXISTS lightfoot_driver_id_location text,
  ADD COLUMN IF NOT EXISTS lightfoot_bp_button_location text;

ALTER TABLE smartfitsinstallationsltd.vdb_vehicle_photos
  DROP CONSTRAINT vdb_vehicle_photos_category_check;
ALTER TABLE smartfitsinstallationsltd.vdb_vehicle_photos
  ADD CONSTRAINT vdb_vehicle_photos_category_check CHECK (category IN (
    'ignition_wire', 'permanent_wire', 'fms_plug', 'earth_point', 'airbag', 'adas_camera',
    'dashcam_mounting', 'tracker_mounting', 'lightfoot_driver_id', 'lightfoot_bp_button',
    'general', 'front', 'back'
  ));

ALTER TABLE smartfitsinstallationsltd.vdb_edit_request_photos
  DROP CONSTRAINT vdb_edit_request_photos_category_check;
ALTER TABLE smartfitsinstallationsltd.vdb_edit_request_photos
  ADD CONSTRAINT vdb_edit_request_photos_category_check CHECK (category IN (
    'ignition_wire', 'permanent_wire', 'fms_plug', 'earth_point', 'airbag', 'adas_camera',
    'dashcam_mounting', 'tracker_mounting', 'lightfoot_driver_id', 'lightfoot_bp_button',
    'general', 'front', 'back'
  ));
