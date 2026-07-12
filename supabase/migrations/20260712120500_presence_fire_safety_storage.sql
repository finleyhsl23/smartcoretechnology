-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 6: Private photo storage
-- Every other bucket in this project is public. Visitor/contractor photos
-- are personal data and must never be publicly reachable — this bucket is
-- private, accessed only via short-lived signed URLs issued server-side
-- after the same permission checks as the visitor/contractor tables.
-- Object path convention: <company_id>/<visitor_id>/<filename>
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'presence-fire-safety-photos',
  'presence-fire-safety-photos',
  false,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY pfs_photos_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'presence-fire-safety-photos'
    AND public.presence_fire_safety_has_permission(
      (split_part(name, '/', 1))::uuid, 'presence.view_live_register'
    )
  );

CREATE POLICY pfs_photos_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'presence-fire-safety-photos'
    AND public.presence_fire_safety_has_permission(
      (split_part(name, '/', 1))::uuid, 'presence.manage_visitors'
    )
  );

CREATE POLICY pfs_photos_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'presence-fire-safety-photos'
    AND public.presence_fire_safety_has_permission(
      (split_part(name, '/', 1))::uuid, 'presence.manage_visitors'
    )
  );
