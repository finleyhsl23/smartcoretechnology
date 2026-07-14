-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 13: Photo storage policy fix
-- The presence-fire-safety-photos bucket is shared between visitor AND
-- contractor photos, but its INSERT/DELETE policies only ever checked
-- presence.manage_visitors. Someone holding presence.manage_contractors
-- without presence.manage_visitors could sign a contractor in with a photo
-- through the RPC layer, but the storage upload itself would be silently
-- rejected by RLS. Broadened to accept either permission.
-- ============================================================================

DROP POLICY IF EXISTS pfs_photos_insert ON storage.objects;
DROP POLICY IF EXISTS pfs_photos_delete ON storage.objects;

CREATE POLICY pfs_photos_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'presence-fire-safety-photos'
    AND (
      public.presence_fire_safety_has_permission((split_part(name, '/', 1))::uuid, 'presence.manage_visitors')
      OR public.presence_fire_safety_has_permission((split_part(name, '/', 1))::uuid, 'presence.manage_contractors')
    )
  );

CREATE POLICY pfs_photos_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'presence-fire-safety-photos'
    AND (
      public.presence_fire_safety_has_permission((split_part(name, '/', 1))::uuid, 'presence.manage_visitors')
      OR public.presence_fire_safety_has_permission((split_part(name, '/', 1))::uuid, 'presence.manage_contractors')
    )
  );
