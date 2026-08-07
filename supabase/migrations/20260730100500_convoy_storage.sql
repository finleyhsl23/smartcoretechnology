-- ============================================================================
-- SmartCore Convoy — Migration 6: Private media storage
-- Walkaround and defect photos are customer data and must never be publicly
-- reachable — private bucket, accessed only via short-lived signed URLs.
-- Object path convention: <company_id>/checks/<check_id>/<photo_id>.<ext>
--                          <company_id>/defects/<defect_id>/<photo_id>.<ext>
--                          <company_id>/vehicles/<vehicle_id>.<ext>
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'convoy-media',
  'convoy-media',
  false,
  26214400,
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY convoy_media_storage_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'convoy-media'
    AND public.convoy_has_permission((split_part(name, '/', 1))::uuid, 'convoy.view_vehicles')
  );

CREATE POLICY convoy_media_storage_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'convoy-media'
    AND (
      (split_part(name, '/', 2) = 'checks' AND public.convoy_has_permission((split_part(name, '/', 1))::uuid, 'convoy.perform_checks'))
      OR (split_part(name, '/', 2) = 'defects' AND public.convoy_has_permission((split_part(name, '/', 1))::uuid, 'convoy.perform_checks'))
      OR (split_part(name, '/', 2) = 'vehicles' AND public.convoy_has_permission((split_part(name, '/', 1))::uuid, 'convoy.manage_vehicles'))
    )
  );

CREATE POLICY convoy_media_storage_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'convoy-media'
    AND public.convoy_has_permission((split_part(name, '/', 1))::uuid, 'convoy.manage_vehicles')
  );
