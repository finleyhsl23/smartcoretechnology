-- ============================================================================
-- SmartCore SiteSnap — Storage policies for the existing private media
-- bucket. Deliberately reuses the bucket physically created as
-- 'sitestamp-media' rather than creating/migrating to a new bucket id: the
-- bucket already holds real uploaded files, and Supabase Storage objects are
-- keyed by bucket+path in the underlying object store, not just this
-- metadata table, so a SQL-only bucket rename would risk orphaning them.
-- The bucket id is internal plumbing never surfaced to users, so this has
-- no user-visible effect. Object path convention unchanged:
--   <company_id>/<project_id>/<media_id>.<ext>
-- ============================================================================

CREATE POLICY sitesnap_media_storage_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'sitestamp-media'
    AND public.sitesnap_has_permission((split_part(name, '/', 1))::uuid, 'sitesnap.view_projects')
    AND public.sitesnap_can_access_project((split_part(name, '/', 2))::uuid)
  );

CREATE POLICY sitesnap_media_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'sitestamp-media'
    AND public.sitesnap_has_permission((split_part(name, '/', 1))::uuid, 'sitesnap.capture_media')
    AND public.sitesnap_can_access_project((split_part(name, '/', 2))::uuid)
  );

CREATE POLICY sitesnap_media_storage_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'sitestamp-media'
    AND public.sitesnap_has_permission((split_part(name, '/', 1))::uuid, 'sitesnap.delete_media')
    AND public.sitesnap_can_access_project((split_part(name, '/', 2))::uuid)
  );
