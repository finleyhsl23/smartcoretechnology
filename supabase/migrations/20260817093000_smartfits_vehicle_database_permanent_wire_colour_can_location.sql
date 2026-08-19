alter table smartfitsinstallationsltd.vdb_vehicles
  add column if not exists permanent_wire_colour text,
  add column if not exists can_location text;

alter table smartfitsinstallationsltd.vdb_vehicle_photos
  drop constraint vdb_vehicle_photos_category_check,
  add constraint vdb_vehicle_photos_category_check
    check (category = any (array['ignition_wire','permanent_wire','fms_plug','can_location','earth_point','airbag','adas_camera','dashcam_mounting','tracker_mounting','lightfoot_driver_id','lightfoot_bp_button','general','front','back']));

alter table smartfitsinstallationsltd.vdb_edit_request_photos
  drop constraint vdb_edit_request_photos_category_check,
  add constraint vdb_edit_request_photos_category_check
    check (category = any (array['ignition_wire','permanent_wire','fms_plug','can_location','earth_point','airbag','adas_camera','dashcam_mounting','tracker_mounting','lightfoot_driver_id','lightfoot_bp_button','general','front','back']));
