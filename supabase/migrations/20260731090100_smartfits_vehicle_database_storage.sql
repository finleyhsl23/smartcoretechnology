-- ============================================================================
-- Smartfits Vehicle Database — photo storage
-- Object path convention:
--   '<vehicle_id>/<file>'          approved photo, attached to vdb_vehicle_photos
--   'pending/<request_id>/<file>'  proposed photo on an unreviewed edit request
-- Bucket is private; every access goes through a signed URL.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'smartfits-vehicle-database-photos',
  'smartfits-vehicle-database-photos',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Each function branches in plpgsql (not a single SQL boolean expression) so
-- the 'pending/...' vs '<vehicle_id>/...' cast to uuid never gets evaluated
-- on the wrong branch of a malformed path.

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.vdb_photo_can_select(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
DECLARE
  seg1 text := split_part(p_name, '/', 1);
BEGIN
  IF smartfitsinstallationsltd.vdb_current_employee_id() IS NULL THEN
    RETURN false;
  END IF;

  IF seg1 = 'pending' THEN
    RETURN smartfitsinstallationsltd.vdb_is_manager() OR EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.vdb_edit_requests r
      WHERE r.id = split_part(p_name, '/', 2)::uuid
        AND r.requested_by = smartfitsinstallationsltd.vdb_current_employee_id()
    );
  END IF;

  -- Any Smartfits employee can view approved vehicle photos.
  RETURN true;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.vdb_photo_can_insert(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
DECLARE
  seg1 text := split_part(p_name, '/', 1);
BEGIN
  IF seg1 = 'pending' THEN
    RETURN EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.vdb_edit_requests r
      WHERE r.id = split_part(p_name, '/', 2)::uuid
        AND r.status = 'pending'
        AND r.requested_by = smartfitsinstallationsltd.vdb_current_employee_id()
    );
  END IF;

  RETURN smartfitsinstallationsltd.vdb_is_manager() AND EXISTS (
    SELECT 1 FROM smartfitsinstallationsltd.vdb_vehicles v WHERE v.id = seg1::uuid
  );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.vdb_photo_can_delete(p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
DECLARE
  seg1 text := split_part(p_name, '/', 1);
BEGIN
  IF smartfitsinstallationsltd.vdb_is_manager() THEN
    RETURN true;
  END IF;

  IF seg1 = 'pending' THEN
    RETURN EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.vdb_edit_requests r
      WHERE r.id = split_part(p_name, '/', 2)::uuid
        AND r.status = 'pending'
        AND r.requested_by = smartfitsinstallationsltd.vdb_current_employee_id()
    );
  END IF;

  RETURN false;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$$;

CREATE POLICY vdb_photos_storage_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'smartfits-vehicle-database-photos'
    AND smartfitsinstallationsltd.vdb_photo_can_select(name)
  );

CREATE POLICY vdb_photos_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'smartfits-vehicle-database-photos'
    AND smartfitsinstallationsltd.vdb_photo_can_insert(name)
  );

CREATE POLICY vdb_photos_storage_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'smartfits-vehicle-database-photos'
    AND smartfitsinstallationsltd.vdb_photo_can_delete(name)
  ) WITH CHECK (
    bucket_id = 'smartfits-vehicle-database-photos'
    AND smartfitsinstallationsltd.vdb_photo_can_insert(name)
  );

CREATE POLICY vdb_photos_storage_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'smartfits-vehicle-database-photos'
    AND smartfitsinstallationsltd.vdb_photo_can_delete(name)
  );
