-- ============================================================================
-- SmartCore Core — Employee profile pictures
-- The profile_picture_url column and employee-avatars bucket may already
-- exist — /api/core/upload-avatar creates the bucket itself on first use
-- (public, 20MB limit) since it shipped before this migration existed. This
-- just formalises the column in version control and adds storage RLS as a
-- defensive backstop; it does not touch the bucket's config (uploads only
-- ever go through that trusted server-side endpoint, which bypasses RLS via
-- the service key, so these policies only matter if a direct client write
-- is ever attempted).
-- ============================================================================

ALTER TABLE public.core_employees
  ADD COLUMN IF NOT EXISTS profile_picture_url text;

-- Resolves whether the caller may upload/replace/delete the avatar at a given
-- (company_id, employee_id) storage path: either it's their own photo, or
-- they're an owner/admin within that same company.
CREATE OR REPLACE FUNCTION public.core_can_manage_employee_avatar(p_company_id uuid, p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.core_employees caller
    WHERE caller.auth_user_id = auth.uid()
      AND caller.company_id = p_company_id
      AND (
        caller.id = p_employee_id
        OR caller.role IN ('owner', 'admin')
      )
  );
$$;

-- Matches what /api/core/upload-avatar already creates at runtime if this
-- runs against a fresh database that's never hit that endpoint yet.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('employee-avatars', 'employee-avatars', true, 20971520)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS employee_avatars_insert ON storage.objects;
DROP POLICY IF EXISTS employee_avatars_update ON storage.objects;
DROP POLICY IF EXISTS employee_avatars_delete ON storage.objects;

CREATE POLICY employee_avatars_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'employee-avatars'
    AND public.core_can_manage_employee_avatar(
      (split_part(name, '/', 1))::uuid,
      (split_part(split_part(name, '/', 2), '.', 1))::uuid
    )
  );

CREATE POLICY employee_avatars_update ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'employee-avatars'
    AND public.core_can_manage_employee_avatar(
      (split_part(name, '/', 1))::uuid,
      (split_part(split_part(name, '/', 2), '.', 1))::uuid
    )
  );

CREATE POLICY employee_avatars_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'employee-avatars'
    AND public.core_can_manage_employee_avatar(
      (split_part(name, '/', 1))::uuid,
      (split_part(split_part(name, '/', 2), '.', 1))::uuid
    )
  );
