-- ============================================================================
-- Smartfits Engineer Install Audit — private photo storage
-- Install photos are evidence tied to a specific engineer's review and must
-- never be publicly reachable. Object path convention: <submission_id>/<filename>
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'smartfits-engineer-audit-photos',
  'smartfits-engineer-audit-photos',
  false,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/heic']
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_can_access_submission(p_submission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM smartfitsinstallationsltd.audit_submissions s
    WHERE s.id = p_submission_id
      AND (
        smartfitsinstallationsltd.audit_is_owner_or_admin()
        OR s.engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
        OR s.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
        OR smartfitsinstallationsltd.audit_is_manager_of(s.engineer_employee_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_can_write_submission(p_submission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM smartfitsinstallationsltd.audit_submissions s
    WHERE s.id = p_submission_id
      AND s.status = 'draft'
      AND (s.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id() OR smartfitsinstallationsltd.audit_is_owner_or_admin())
  );
$$;

CREATE POLICY audit_photos_storage_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'smartfits-engineer-audit-photos'
    AND smartfitsinstallationsltd.audit_can_access_submission((split_part(name, '/', 1))::uuid)
  );

CREATE POLICY audit_photos_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'smartfits-engineer-audit-photos'
    AND smartfitsinstallationsltd.audit_can_write_submission((split_part(name, '/', 1))::uuid)
  );

CREATE POLICY audit_photos_storage_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'smartfits-engineer-audit-photos'
    AND smartfitsinstallationsltd.audit_can_write_submission((split_part(name, '/', 1))::uuid)
  );
