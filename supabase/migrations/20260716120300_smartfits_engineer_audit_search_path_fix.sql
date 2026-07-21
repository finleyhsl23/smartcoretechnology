-- Pin search_path on the plain SQL/PL-pgSQL helper functions added in the
-- engineer-audit foundation migration (the SECURITY DEFINER STABLE functions
-- already had one; these three didn't).
CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_company_id()
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT '34c3dc62-25dc-4159-b159-ae7b24479bee'::uuid;
$$;

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_submissions_lock_submitted()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_temp
AS $$
BEGIN
  IF OLD.status = 'submitted' THEN
    RAISE EXCEPTION 'Submitted audits are locked and cannot be edited. Create a new submission with supersedes_submission_id instead.';
  END IF;
  IF NEW.status = 'submitted' AND NEW.submitted_at IS NULL THEN
    NEW.submitted_at = now();
  END IF;
  RETURN NEW;
END;
$$;
