-- ============================================================================
-- SmartCore Presence & Fire Safety — Migration 12: Contractor photo + sound
-- effects setting
-- ============================================================================

ALTER TABLE public.presence_fire_safety_contractors
  ADD COLUMN IF NOT EXISTS photo_path text;

ALTER TABLE public.presence_fire_safety_settings
  ADD COLUMN IF NOT EXISTS sound_effects_enabled boolean NOT NULL DEFAULT true;

-- Extend the contractor visit RPC with an optional photo path, mirroring the
-- visitor visit RPC. CREATE OR REPLACE cannot change a function's parameter
-- list (that creates a second overload instead of replacing it), so the old
-- 12-parameter signature is dropped explicitly first.
DROP FUNCTION IF EXISTS public.presence_fire_safety_create_contractor_visit(
  uuid, uuid, text, text, text, text, uuid, text, text, text, boolean, boolean
);

CREATE OR REPLACE FUNCTION public.presence_fire_safety_create_contractor_visit(
  p_company_id uuid,
  p_site_id uuid,
  p_business_name text,
  p_contact_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_host_employee_id uuid DEFAULT NULL,
  p_work_purpose text DEFAULT NULL,
  p_permit_reference text DEFAULT NULL,
  p_vehicle_registration text DEFAULT NULL,
  p_induction_confirmed boolean DEFAULT false,
  p_sign_in_now boolean DEFAULT true,
  p_photo_path text DEFAULT NULL
)
RETURNS public.presence_fire_safety_contractor_visits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller public.core_employees;
  v_contractor_id uuid;
  v_visit public.presence_fire_safety_contractor_visits;
BEGIN
  IF NOT public.presence_fire_safety_module_enabled(p_company_id) THEN
    RAISE EXCEPTION 'Presence & Fire Safety is not enabled for this company' USING ERRCODE = '42501';
  END IF;
  IF NOT public.presence_fire_safety_has_site_access(p_company_id, p_site_id) THEN
    RAISE EXCEPTION 'No access to this site' USING ERRCODE = '42501';
  END IF;
  IF NOT public.presence_fire_safety_has_permission(p_company_id, 'presence.manage_contractors') THEN
    RAISE EXCEPTION 'Missing permission: presence.manage_contractors' USING ERRCODE = '42501';
  END IF;

  v_caller := public.presence_fire_safety_current_employee(p_company_id);
  IF v_caller.id IS NULL THEN
    RAISE EXCEPTION 'Employee profile not found' USING ERRCODE = '42501';
  END IF;

  IF p_business_name IS NULL OR length(trim(p_business_name)) = 0 THEN
    RAISE EXCEPTION 'Business name is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.presence_fire_safety_contractors (company_id, business_name, contact_name, phone, email, photo_path)
  VALUES (p_company_id, trim(p_business_name), p_contact_name, p_phone, p_email, p_photo_path)
  RETURNING id INTO v_contractor_id;

  INSERT INTO public.presence_fire_safety_contractor_visits (
    company_id, site_id, contractor_id, host_employee_id, work_purpose, permit_reference,
    vehicle_registration, induction_confirmed_at, status, created_by
  ) VALUES (
    p_company_id, p_site_id, v_contractor_id, p_host_employee_id, p_work_purpose, p_permit_reference,
    p_vehicle_registration, CASE WHEN p_induction_confirmed THEN now() ELSE NULL END, 'expected', v_caller.id
  ) RETURNING * INTO v_visit;

  IF p_sign_in_now THEN
    PERFORM public.presence_fire_safety_record_presence_event(
      p_company_id, p_site_id, 'contractor', 'in', 'manual',
      NULL, NULL, v_visit.id, NULL,
      'contractor-signin-' || v_visit.id::text, 'Contractor sign-in'
    );
    SELECT * INTO v_visit FROM public.presence_fire_safety_contractor_visits WHERE id = v_visit.id;
  END IF;

  RETURN v_visit;
END;
$$;
REVOKE ALL ON FUNCTION public.presence_fire_safety_create_contractor_visit FROM PUBLIC;
REVOKE ALL ON FUNCTION public.presence_fire_safety_create_contractor_visit FROM anon;
GRANT EXECUTE ON FUNCTION public.presence_fire_safety_create_contractor_visit TO authenticated;
