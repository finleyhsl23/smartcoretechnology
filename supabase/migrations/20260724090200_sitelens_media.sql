-- ============================================================================
-- SmartCore SiteLens — Migration 3: Media (photos & videos), tags, comments
-- Object path convention (see migration 6 for storage bucket + RLS):
--   <company_id>/<project_id>/<media_id>.<ext>
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sitelens_media (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.sitelens_projects(id) ON DELETE CASCADE,
  media_type        text NOT NULL CHECK (media_type IN ('photo', 'video')),
  storage_path      text NOT NULL,
  caption           text,
  latitude          numeric(9,6),
  longitude         numeric(9,6),
  taken_at          timestamptz NOT NULL DEFAULT now(),
  uploaded_by       uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  file_size_bytes   bigint,
  width             integer,
  height            integer,
  duration_seconds  numeric,
  annotations       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sitelens_media_project_idx ON public.sitelens_media(project_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS sitelens_media_company_idx ON public.sitelens_media(company_id);

-- RLS row policies can't restrict which columns an UPDATE touches — an
-- uploader without manage_projects must be limited to editing their own
-- caption/annotations, not reassigning the file to a different project or
-- rewriting its storage_path via a raw API call.
CREATE OR REPLACE FUNCTION public.sitelens_media_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.sitelens_has_permission(NEW.company_id, 'sitelens.manage_projects') THEN
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
      OR NEW.media_type IS DISTINCT FROM OLD.media_type
      OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
    THEN
      RAISE EXCEPTION 'Only caption, tags and annotations can be edited without sitelens.manage_projects permission.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sitelens_media_guard_update_trg ON public.sitelens_media;
CREATE TRIGGER sitelens_media_guard_update_trg BEFORE UPDATE ON public.sitelens_media
  FOR EACH ROW EXECUTE FUNCTION public.sitelens_media_guard_update();

ALTER TABLE public.sitelens_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitelens_media_select ON public.sitelens_media
  FOR SELECT USING (
    public.sitelens_has_permission(company_id, 'sitelens.view_projects')
    AND public.sitelens_can_access_project(project_id)
  );

CREATE POLICY sitelens_media_insert ON public.sitelens_media
  FOR INSERT WITH CHECK (
    public.sitelens_has_permission(company_id, 'sitelens.capture_media')
    AND public.sitelens_can_access_project(project_id)
  );

CREATE POLICY sitelens_media_update ON public.sitelens_media
  FOR UPDATE USING (
    public.sitelens_can_access_project(project_id)
    AND (
      uploaded_by = public.sitelens_current_employee_id(company_id)
      OR public.sitelens_has_permission(company_id, 'sitelens.manage_projects')
    )
  ) WITH CHECK (
    public.sitelens_can_access_project(project_id)
  );

CREATE POLICY sitelens_media_delete ON public.sitelens_media
  FOR DELETE USING (
    public.sitelens_has_permission(company_id, 'sitelens.delete_media')
    AND public.sitelens_can_access_project(project_id)
  );

-- ----------------------------------------------------------------------------
-- Media tags (join table against the company tag catalog)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitelens_media_tags (
  media_id  uuid NOT NULL REFERENCES public.sitelens_media(id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL REFERENCES public.sitelens_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, tag_id)
);

ALTER TABLE public.sitelens_media_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitelens_media_tags_select ON public.sitelens_media_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sitelens_media m
      WHERE m.id = media_id
        AND public.sitelens_has_permission(m.company_id, 'sitelens.view_projects')
        AND public.sitelens_can_access_project(m.project_id)
    )
  );

CREATE POLICY sitelens_media_tags_write ON public.sitelens_media_tags
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.sitelens_media m
      WHERE m.id = media_id AND public.sitelens_has_permission(m.company_id, 'sitelens.capture_media')
        AND public.sitelens_can_access_project(m.project_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sitelens_media m
      WHERE m.id = media_id AND public.sitelens_has_permission(m.company_id, 'sitelens.capture_media')
        AND public.sitelens_can_access_project(m.project_id)
    )
  );

-- ----------------------------------------------------------------------------
-- Media comments — lightweight discussion thread on a photo/video.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitelens_media_comments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id           uuid NOT NULL REFERENCES public.sitelens_media(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  author_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  body               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sitelens_media_comments_media_idx ON public.sitelens_media_comments(media_id, created_at);

ALTER TABLE public.sitelens_media_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitelens_media_comments_select ON public.sitelens_media_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sitelens_media m
      WHERE m.id = media_id AND public.sitelens_has_permission(m.company_id, 'sitelens.view_projects')
        AND public.sitelens_can_access_project(m.project_id)
    )
  );

CREATE POLICY sitelens_media_comments_insert ON public.sitelens_media_comments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sitelens_media m
      WHERE m.id = media_id AND public.sitelens_has_permission(m.company_id, 'sitelens.view_projects')
        AND public.sitelens_can_access_project(m.project_id)
    )
  );

CREATE POLICY sitelens_media_comments_delete_own ON public.sitelens_media_comments
  FOR DELETE USING (
    author_employee_id = public.sitelens_current_employee_id(company_id)
    OR public.sitelens_has_permission(company_id, 'sitelens.manage_projects')
  );
