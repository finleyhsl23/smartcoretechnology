-- ============================================================================
-- SmartCore SiteSnap — Allow deleting a task's own proof photo on undo.
-- Reopening a task (done -> open) should discard its proof photo, but
-- regular employees don't hold sitesnap.delete_media (two-tier permissions:
-- only owners/admins do) — without this they could complete a task with a
-- photo but never be able to retract it themselves. Narrow carve-out: the
-- employee who uploaded a task-linked photo may delete that specific photo
-- (table row + storage object) without delete_media. General media curation
-- (deleting anyone's regular project photos) still requires delete_media.
-- ============================================================================

DROP POLICY IF EXISTS sitesnap_media_delete ON public.sitesnap_media;
CREATE POLICY sitesnap_media_delete ON public.sitesnap_media
  FOR DELETE USING (
    public.sitesnap_can_access_project(project_id)
    AND (
      public.sitesnap_has_permission(company_id, 'sitesnap.delete_media')
      OR (task_id IS NOT NULL AND uploaded_by = public.sitesnap_current_employee_id(company_id))
    )
  );

DROP POLICY IF EXISTS sitesnap_media_storage_delete_v2 ON storage.objects;
CREATE POLICY sitesnap_media_storage_delete_v2 ON storage.objects
  FOR DELETE USING (
    bucket_id = 'sitesnap-media'
    AND public.sitesnap_can_access_project((split_part(name, '/', 2))::uuid)
    AND (
      public.sitesnap_has_permission((split_part(name, '/', 1))::uuid, 'sitesnap.delete_media')
      OR EXISTS (
        SELECT 1 FROM public.sitesnap_media m
        WHERE m.storage_path = name AND m.task_id IS NOT NULL
          AND m.uploaded_by = public.sitesnap_current_employee_id(m.company_id)
      )
    )
  );
