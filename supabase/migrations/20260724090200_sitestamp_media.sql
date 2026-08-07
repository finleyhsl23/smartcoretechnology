-- ============================================================================
-- SmartCore SiteStamp — Migration 3: Media (photos & videos), tags, comments
-- Object path convention (see migration 6 for storage bucket + RLS):
--   <company_id>/<project_id>/<media_id>.<ext>
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sitestamp_media (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.sitestamp_projects(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS sitestamp_media_project_idx ON public.sitestamp_media(project_id, taken_at DESC);
CREATE INDEX IF NOT EXISTS sitestamp_media_company_idx ON public.sitestamp_media(company_id);

-- RLS row policies can't restrict which columns an UPDATE touches — an
-- uploader without manage_projects must be limited to editing their own
-- caption/annotations, not reassigning the file to a different project or
-- rewriting its storage_path via a raw API call.
CREATE OR REPLACE FUNCTION public.sitestamp_media_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.sitestamp_has_permission(NEW.company_id, 'sitestamp.manage_projects') THEN
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
      OR NEW.media_type IS DISTINCT FROM OLD.media_type
      OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
    THEN
      RAISE EXCEPTION 'Only caption, tags and annotations can be edited without sitestamp.manage_projects permission.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sitestamp_media_guard_update_trg ON public.sitestamp_media;
CREATE TRIGGER sitestamp_media_guard_update_trg BEFORE UPDATE ON public.sitestamp_media
  FOR EACH ROW EXECUTE FUNCTION public.sitestamp_media_guard_update();

ALTER TABLE public.sitestamp_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitestamp_media_select ON public.sitestamp_media
  FOR SELECT USING (
    public.sitestamp_has_permission(company_id, 'sitestamp.view_projects')
    AND public.sitestamp_can_access_project(project_id)
  );

CREATE POLICY sitestamp_media_insert ON public.sitestamp_media
  FOR INSERT WITH CHECK (
    public.sitestamp_has_permission(company_id, 'sitestamp.capture_media')
    AND public.sitestamp_can_access_project(project_id)
  );

CREATE POLICY sitestamp_media_update ON public.sitestamp_media
  FOR UPDATE USING (
    public.sitestamp_can_access_project(project_id)
    AND (
      uploaded_by = public.sitestamp_current_employee_id(company_id)
      OR public.sitestamp_has_permission(company_id, 'sitestamp.manage_projects')
    )
  ) WITH CHECK (
    public.sitestamp_can_access_project(project_id)
  );

CREATE POLICY sitestamp_media_delete ON public.sitestamp_media
  FOR DELETE USING (
    public.sitestamp_has_permission(company_id, 'sitestamp.delete_media')
    AND public.sitestamp_can_access_project(project_id)
  );

-- ----------------------------------------------------------------------------
-- Media tags (join table against the company tag catalog)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitestamp_media_tags (
  media_id  uuid NOT NULL REFERENCES public.sitestamp_media(id) ON DELETE CASCADE,
  tag_id    uuid NOT NULL REFERENCES public.sitestamp_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, tag_id)
);

ALTER TABLE public.sitestamp_media_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitestamp_media_tags_select ON public.sitestamp_media_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sitestamp_media m
      WHERE m.id = media_id
        AND public.sitestamp_has_permission(m.company_id, 'sitestamp.view_projects')
        AND public.sitestamp_can_access_project(m.project_id)
    )
  );

CREATE POLICY sitestamp_media_tags_write ON public.sitestamp_media_tags
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.sitestamp_media m
      WHERE m.id = media_id AND public.sitestamp_has_permission(m.company_id, 'sitestamp.capture_media')
        AND public.sitestamp_can_access_project(m.project_id)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sitestamp_media m
      WHERE m.id = media_id AND public.sitestamp_has_permission(m.company_id, 'sitestamp.capture_media')
        AND public.sitestamp_can_access_project(m.project_id)
    )
  );

-- ----------------------------------------------------------------------------
-- Media comments — lightweight discussion thread on a photo/video.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sitestamp_media_comments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id           uuid NOT NULL REFERENCES public.sitestamp_media(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES public.smartcore_core_companies(id) ON DELETE CASCADE,
  author_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  body               text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sitestamp_media_comments_media_idx ON public.sitestamp_media_comments(media_id, created_at);

ALTER TABLE public.sitestamp_media_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY sitestamp_media_comments_select ON public.sitestamp_media_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.sitestamp_media m
      WHERE m.id = media_id AND public.sitestamp_has_permission(m.company_id, 'sitestamp.view_projects')
        AND public.sitestamp_can_access_project(m.project_id)
    )
  );

CREATE POLICY sitestamp_media_comments_insert ON public.sitestamp_media_comments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sitestamp_media m
      WHERE m.id = media_id AND public.sitestamp_has_permission(m.company_id, 'sitestamp.view_projects')
        AND public.sitestamp_can_access_project(m.project_id)
    )
  );

CREATE POLICY sitestamp_media_comments_delete_own ON public.sitestamp_media_comments
  FOR DELETE USING (
    author_employee_id = public.sitestamp_current_employee_id(company_id)
    OR public.sitestamp_has_permission(company_id, 'sitestamp.manage_projects')
  );
