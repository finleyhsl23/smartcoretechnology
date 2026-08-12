-- ============================================================================
-- Smartfits Vehicle Database — "Fuse Tap Options" renamed to "Permanent Wire
-- — Exact Location" and given its own photo category, matching how Ignition
-- Wire Location and Earth Point Location already work. The field's storage
-- key (fuse_tap_options) is left as-is — only the label changed — so no
-- existing data needs to move.
-- ============================================================================

ALTER TABLE smartfitsinstallationsltd.vdb_vehicle_photos
  DROP CONSTRAINT vdb_vehicle_photos_category_check;
ALTER TABLE smartfitsinstallationsltd.vdb_vehicle_photos
  ADD CONSTRAINT vdb_vehicle_photos_category_check CHECK (category IN (
    'ignition_wire', 'permanent_wire', 'earth_point', 'airbag', 'adas_camera',
    'dashcam_mounting', 'tracker_mounting', 'general', 'front', 'back'
  ));

ALTER TABLE smartfitsinstallationsltd.vdb_edit_request_photos
  DROP CONSTRAINT vdb_edit_request_photos_category_check;
ALTER TABLE smartfitsinstallationsltd.vdb_edit_request_photos
  ADD CONSTRAINT vdb_edit_request_photos_category_check CHECK (category IN (
    'ignition_wire', 'permanent_wire', 'earth_point', 'airbag', 'adas_camera',
    'dashcam_mounting', 'tracker_mounting', 'general', 'front', 'back'
  ));
