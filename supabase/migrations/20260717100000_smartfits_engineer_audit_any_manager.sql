-- ============================================================================
-- Smartfits Engineer Install Audit — any Engineering Manager may audit any
-- engineer, not just their currently-assigned ones. audit_is_manager_of()
-- was too narrow: it blocked other managers from auditing an unassigned
-- engineer, and (since the audit_submissions_select / audit_photos_select /
-- audit_performance_notes_select / audit_training_records_select policies
-- all leaned on it) it also hid every other manager's submissions from a
-- manager who wasn't currently assigned to that engineer — which is why the
-- leaderboard came up empty for managers even though submissions existed.
--
-- audit_is_any_manager() mirrors auth.js's resolveTier(): true if the caller
-- is on the Senior Regional Engineering Manager roster OR currently has at
-- least one active assignment to anyone — i.e. true for anyone the UI
-- treats as "manager" tier, regardless of who they're personally assigned to.
-- ============================================================================

CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_is_any_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.audit_settings s
      WHERE smartfitsinstallationsltd.audit_current_employee_id() = ANY(s.manager_employee_ids)
    )
    OR EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.audit_manager_assignments a
      WHERE a.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
        AND a.is_active
    );
$$;

-- ── audit_submissions ────────────────────────────────────────────────────
DROP POLICY IF EXISTS audit_submissions_select ON smartfitsinstallationsltd.audit_submissions;
CREATE POLICY audit_submissions_select ON smartfitsinstallationsltd.audit_submissions
  FOR SELECT USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
    OR manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
    OR smartfitsinstallationsltd.audit_is_any_manager()
  );

DROP POLICY IF EXISTS audit_submissions_insert ON smartfitsinstallationsltd.audit_submissions;
CREATE POLICY audit_submissions_insert ON smartfitsinstallationsltd.audit_submissions
  FOR INSERT WITH CHECK (
    manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
    AND (
      smartfitsinstallationsltd.audit_is_owner_or_admin()
      OR smartfitsinstallationsltd.audit_is_any_manager()
    )
  );

-- ── audit_submission_scores ──────────────────────────────────────────────
DROP POLICY IF EXISTS audit_submission_scores_select ON smartfitsinstallationsltd.audit_submission_scores;
CREATE POLICY audit_submission_scores_select ON smartfitsinstallationsltd.audit_submission_scores
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.audit_submissions s
      WHERE s.id = audit_submission_scores.submission_id
        AND (
          smartfitsinstallationsltd.audit_is_owner_or_admin()
          OR s.engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
          OR s.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
          OR smartfitsinstallationsltd.audit_is_any_manager()
        )
    )
  );

-- ── audit_photos ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS audit_photos_select ON smartfitsinstallationsltd.audit_photos;
CREATE POLICY audit_photos_select ON smartfitsinstallationsltd.audit_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM smartfitsinstallationsltd.audit_submissions s
      WHERE s.id = audit_photos.submission_id
        AND (
          smartfitsinstallationsltd.audit_is_owner_or_admin()
          OR s.engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
          OR s.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
          OR smartfitsinstallationsltd.audit_is_any_manager()
        )
    )
  );

-- ── Storage (photo bucket) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION smartfitsinstallationsltd.audit_can_access_submission(p_submission_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, smartfitsinstallationsltd, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM smartfitsinstallationsltd.audit_submissions s
    WHERE s.id = p_submission_id
      AND (
        smartfitsinstallationsltd.audit_is_owner_or_admin()
        OR s.engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
        OR s.manager_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
        OR smartfitsinstallationsltd.audit_is_any_manager()
      )
  );
$$;

-- ── Performance notes ────────────────────────────────────────────────────
DROP POLICY IF EXISTS audit_performance_notes_select ON smartfitsinstallationsltd.audit_performance_notes;
CREATE POLICY audit_performance_notes_select ON smartfitsinstallationsltd.audit_performance_notes
  FOR SELECT USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR smartfitsinstallationsltd.audit_is_any_manager()
    OR engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
  );

DROP POLICY IF EXISTS audit_performance_notes_insert ON smartfitsinstallationsltd.audit_performance_notes;
CREATE POLICY audit_performance_notes_insert ON smartfitsinstallationsltd.audit_performance_notes
  FOR INSERT WITH CHECK (
    author_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
    AND (
      smartfitsinstallationsltd.audit_is_owner_or_admin()
      OR smartfitsinstallationsltd.audit_is_any_manager()
    )
  );

-- ── Training records ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS audit_training_records_select ON smartfitsinstallationsltd.audit_training_records;
CREATE POLICY audit_training_records_select ON smartfitsinstallationsltd.audit_training_records
  FOR SELECT USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR smartfitsinstallationsltd.audit_is_any_manager()
    OR engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
  );

DROP POLICY IF EXISTS audit_training_records_write ON smartfitsinstallationsltd.audit_training_records;
CREATE POLICY audit_training_records_write ON smartfitsinstallationsltd.audit_training_records
  FOR ALL USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR smartfitsinstallationsltd.audit_is_any_manager()
  ) WITH CHECK (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR smartfitsinstallationsltd.audit_is_any_manager()
  );
