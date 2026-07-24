-- ============================================================================
-- SmartCore SiteLens — Migration 7: Private media storage
-- Job-site photos/videos are customer data and must never be publicly
-- reachable — private bucket, accessed only via short-lived signed URLs
-- after the same permission + project-access checks as sitelens_media.
-- Object path convention: <company_id>/<project_id>/<media_id>.<ext>
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sitelens-media',
  'sitelens-media',
  false,
  524288000,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime','video/webm']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY sitelens_media_storage_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'sitelens-media'
    AND public.sitelens_has_permission((split_part(name, '/', 1))::uuid, 'sitelens.view_projects')
    AND public.sitelens_can_access_project((split_part(name, '/', 2))::uuid)
  );

CREATE POLICY sitelens_media_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'sitelens-media'
    AND public.sitelens_has_permission((split_part(name, '/', 1))::uuid, 'sitelens.capture_media')
    AND public.sitelens_can_access_project((split_part(name, '/', 2))::uuid)
  );

CREATE POLICY sitelens_media_storage_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'sitelens-media'
    AND public.sitelens_has_permission((split_part(name, '/', 1))::uuid, 'sitelens.delete_media')
    AND public.sitelens_can_access_project((split_part(name, '/', 2))::uuid)
  );
