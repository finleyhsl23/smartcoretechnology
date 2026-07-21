-- ============================================================================
-- Smartfits Installations Ltd — Engineer Install Audit Module
-- Tables live in the smartfitsinstallationsltd schema (audit_ prefix, per the
-- tenant-schema convention already used there for leave/sickness data).
-- Identity is public.core_employees / public.smartcore_core_companies — the
-- same identity source the /modules/ directory and the Presence & Fire
-- Safety module use — NOT the older smartfitsinstallationsltd.employees
-- table, which only the legacy Holiday Management module still uses.
--
-- This schema is provably single-tenant (Smartfits only), so the Smartfits
-- company_id is hardcoded into the helper functions below rather than
-- threaded through every table as a redundant column.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper functions
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_company_id()
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '34c3dc62-25dc-4159-b159-ae7b24479bee'::uuid;
$$;

-- Resolves the caller's own core_employees row within Smartfits, or NULL.
CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_current_employee()
RETURNS public.core_employees
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT ce.* FROM public.core_employees ce
  WHERE ce.auth_user_id = auth.uid()
    AND ce.company_id = smartfitsinstallationsltd.audit_company_id()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT ce.id FROM public.core_employees ce
  WHERE ce.auth_user_id = auth.uid()
    AND ce.company_id = smartfitsinstallationsltd.audit_company_id()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_is_owner_or_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.core_employees ce
    WHERE ce.auth_user_id = auth.uid()
      AND ce.company_id = smartfitsinstallationsltd.audit_company_id()
      AND ce.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- audit_criteria — the 15 scoring criteria, stored as data so Owner/Admin can
-- edit/reorder/deactivate them later without a code change.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.audit_criteria (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  label       text NOT NULL,
  category    text NOT NULL CHECK (category IN ('photo', 'job_sheet')),
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE smartfitsinstallationsltd.audit_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_criteria_select ON smartfitsinstallationsltd.audit_criteria
  FOR SELECT USING (smartfitsinstallationsltd.audit_current_employee_id() IS NOT NULL);

CREATE POLICY audit_criteria_write_admin ON smartfitsinstallationsltd.audit_criteria
  FOR ALL USING (smartfitsinstallationsltd.audit_is_owner_or_admin())
  WITH CHECK (smartfitsinstallationsltd.audit_is_owner_or_admin());

-- ----------------------------------------------------------------------------
-- audit_manager_assignments — many engineers -> one active manager. Kept
-- configurable (no hard uniqueness constraint) rather than baking in a
-- one-manager-per-engineer rule at the database level, in case Smartfits
-- later wants shared oversight; the assignment UI is responsible for
-- deactivating a prior assignment before creating a new one.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.audit_manager_assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_employee_id   uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  engineer_employee_id  uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  assigned_by           uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  assigned_at           timestamptz NOT NULL DEFAULT now(),
  is_active             boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS audit_manager_assignments_manager_idx
  ON smartfitsinstallationsltd.audit_manager_assignments(manager_employee_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS audit_manager_assignments_engineer_idx
  ON smartfitsinstallationsltd.audit_manager_assignments(engineer_employee_id) WHERE is_active;

-- True if the caller is the currently-active Engineering Manager for this
-- engineer. "Engineering Manager" is not a stored role — it is an emergent
-- property of appearing as manager_employee_id on an active assignment row,
-- so the shared, platform-wide core_employees.role column (read by every
-- other module/tenant) never needs an audit-module-specific value added.
CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_is_manager_of(p_engineer_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM smartfitsinstallationsltd.audit_manager_assignments a
    WHERE a.engineer_employee_id = p_engineer_employee_id
      AND a.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
      AND a.is_active
  );
$$;

ALTER TABLE smartfitsinstallationsltd.audit_manager_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_manager_assignments_select ON smartfitsinstallationsltd.audit_manager_assignments
  FOR SELECT USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
    OR engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
  );

CREATE POLICY audit_manager_assignments_write_admin ON smartfitsinstallationsltd.audit_manager_assignments
  FOR ALL USING (smartfitsinstallationsltd.audit_is_owner_or_admin())
  WITH CHECK (smartfitsinstallationsltd.audit_is_owner_or_admin());

-- ----------------------------------------------------------------------------
-- audit_submissions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.audit_submissions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_employee_id     uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  manager_employee_id      uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  job_sheet_text           text,
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  overall_notes            text,
  supersedes_submission_id uuid REFERENCES smartfitsinstallationsltd.audit_submissions(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  submitted_at             timestamptz
);

CREATE INDEX IF NOT EXISTS audit_submissions_engineer_idx ON smartfitsinstallationsltd.audit_submissions(engineer_employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_submissions_manager_idx ON smartfitsinstallationsltd.audit_submissions(manager_employee_id);

DROP TRIGGER IF EXISTS audit_submissions_set_updated_at ON smartfitsinstallationsltd.audit_submissions;
CREATE TRIGGER audit_submissions_set_updated_at BEFORE UPDATE ON smartfitsinstallationsltd.audit_submissions
  FOR EACH ROW EXECUTE FUNCTION smartfitsinstallationsltd.set_updated_at();

-- Submitted audits are locked from editing at the database level, independent
-- of RLS: once status flips to 'submitted' nothing (including a future admin
-- tool running with elevated rights) can silently edit history. Amendments
-- must go through a new row referencing supersedes_submission_id.
CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_submissions_lock_submitted()
RETURNS trigger
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS audit_submissions_lock_submitted_trg ON smartfitsinstallationsltd.audit_submissions;
CREATE TRIGGER audit_submissions_lock_submitted_trg BEFORE UPDATE ON smartfitsinstallationsltd.audit_submissions
  FOR EACH ROW EXECUTE FUNCTION smartfitsinstallationsltd.audit_submissions_lock_submitted();

ALTER TABLE smartfitsinstallationsltd.audit_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_submissions_select ON smartfitsinstallationsltd.audit_submissions
  FOR SELECT USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
    OR manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
    OR smartfitsinstallationsltd.audit_is_manager_of(engineer_employee_id)
  );

CREATE POLICY audit_submissions_insert ON smartfitsinstallationsltd.audit_submissions
  FOR INSERT WITH CHECK (
    manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
    AND (
      smartfitsinstallationsltd.audit_is_owner_or_admin()
      OR smartfitsinstallationsltd.audit_is_manager_of(engineer_employee_id)
    )
  );

-- Only the author (or Owner/Admin) may edit, and only while still a draft —
-- enforced here via USING (pre-update row) as well as by the trigger above.
CREATE POLICY audit_submissions_update ON smartfitsinstallationsltd.audit_submissions
  FOR UPDATE USING (
    status = 'draft'
    AND (
      manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
      OR smartfitsinstallationsltd.audit_is_owner_or_admin()
    )
  ) WITH CHECK (
    manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
    OR smartfitsinstallationsltd.audit_is_owner_or_admin()
  );

CREATE POLICY audit_submissions_delete ON smartfitsinstallationsltd.audit_submissions
  FOR DELETE USING (
    status = 'draft'
    AND (
      manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
      OR smartfitsinstallationsltd.audit_is_owner_or_admin()
    )
  );

-- ----------------------------------------------------------------------------
-- audit_submission_scores
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.audit_submission_scores (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES smartfitsinstallationsltd.audit_submissions(id) ON DELETE CASCADE,
  criterion_id   uuid NOT NULL REFERENCES smartfitsinstallationsltd.audit_criteria(id),
  score          smallint NOT NULL CHECK (score IN (1, 2, 3)),
  comment        text,
  UNIQUE (submission_id, criterion_id)
);

CREATE INDEX IF NOT EXISTS audit_submission_scores_submission_idx ON smartfitsinstallationsltd.audit_submission_scores(submission_id);

ALTER TABLE smartfitsinstallationsltd.audit_submission_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_submission_scores_select ON smartfitsinstallationsltd.audit_submission_scores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.audit_submissions s
      WHERE s.id = audit_submission_scores.submission_id
        AND (
          smartfitsinstallationsltd.audit_is_owner_or_admin()
          OR s.engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
          OR s.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
          OR smartfitsinstallationsltd.audit_is_manager_of(s.engineer_employee_id)
        )
    )
  );

CREATE POLICY audit_submission_scores_write ON smartfitsinstallationsltd.audit_submission_scores
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.audit_submissions s
      WHERE s.id = audit_submission_scores.submission_id
        AND s.status = 'draft'
        AND (s.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id() OR smartfitsinstallationsltd.audit_is_owner_or_admin())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.audit_submissions s
      WHERE s.id = audit_submission_scores.submission_id
        AND s.status = 'draft'
        AND (s.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id() OR smartfitsinstallationsltd.audit_is_owner_or_admin())
    )
  );

-- ----------------------------------------------------------------------------
-- audit_photos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.audit_photos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES smartfitsinstallationsltd.audit_submissions(id) ON DELETE CASCADE,
  criterion_id   uuid REFERENCES smartfitsinstallationsltd.audit_criteria(id),
  storage_path   text NOT NULL,
  uploaded_by    uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_photos_submission_idx ON smartfitsinstallationsltd.audit_photos(submission_id);

ALTER TABLE smartfitsinstallationsltd.audit_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_photos_select ON smartfitsinstallationsltd.audit_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.audit_submissions s
      WHERE s.id = audit_photos.submission_id
        AND (
          smartfitsinstallationsltd.audit_is_owner_or_admin()
          OR s.engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
          OR s.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
          OR smartfitsinstallationsltd.audit_is_manager_of(s.engineer_employee_id)
        )
    )
  );

CREATE POLICY audit_photos_write ON smartfitsinstallationsltd.audit_photos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.audit_submissions s
      WHERE s.id = audit_photos.submission_id
        AND s.status = 'draft'
        AND (s.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id() OR smartfitsinstallationsltd.audit_is_owner_or_admin())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.audit_submissions s
      WHERE s.id = audit_photos.submission_id
        AND s.status = 'draft'
        AND (s.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id() OR smartfitsinstallationsltd.audit_is_owner_or_admin())
    )
  );

-- ----------------------------------------------------------------------------
-- Seed the 15 v1 criteria
-- ----------------------------------------------------------------------------
INSERT INTO smartfitsinstallationsltd.audit_criteria (code, label, category, sort_order) VALUES
  ('photo_set_complete',   'Before/after photo set complete (mounting point, cable run, finished install, serial/label)', 'photo', 10),
  ('mounting_security',    'Mounting security — bracket/fixing visible as flush and correctly fitted, no movement',      'photo', 20),
  ('cable_routing',        'Cable routing — routed through trim/factory channels, not exposed',                          'photo', 30),
  ('cable_protection',     'Cable protection — grommet/sleeving visible at any metal entry/exit point',                  'photo', 40),
  ('power_connection',     'Power connection — crimp/fuse/joint visible and correctly made, no bare wire or taped joint','photo', 50),
  ('camera_alignment',     'Camera alignment/field of view correct (where applicable to the job)',                      'photo', 60),
  ('serial_label_match',   'Serial number/label photo matches the number logged on the job sheet',                      'photo', 70),
  ('no_vehicle_damage',    'No visible vehicle damage in before/after comparison (trim, paintwork, interior)',          'photo', 80),
  ('functional_test',      'Functional test recorded — what was tested and confirmed working',                         'job_sheet', 90),
  ('fault_log',            'Fault/issue log — any problems encountered and how they were resolved, clearly described', 'job_sheet', 100),
  ('time_vs_sla',          'Time taken vs SLA — logged and within the agreed install window',                          'job_sheet', 110),
  ('customer_signoff',     'Customer sign-off — signature or photo of signed paperwork attached',                      'job_sheet', 120),
  ('parts_stock_logged',   'Parts/stock used — correctly logged against the job',                                      'job_sheet', 130),
  ('job_sheet_complete',   'Job sheet completeness — all required fields filled in, nothing left blank',               'job_sheet', 140),
  ('writeup_quality',      'Write-up quality — description is specific and checkable, not generic ("fitted OK")',      'job_sheet', 150)
ON CONFLICT (code) DO NOTHING;
