-- ============================================================================
-- Smartfits Engineer Install Audit — criteria overhaul + N/A scoring +
-- low-score manager alert support
--
-- 1. Allow score = 0 to mean "N/A" on every criterion (was CHECK (1,2,3)).
--    N/A is excluded from average/percentage calculations client-side.
-- 2. New criterion: Earth Point Visible (photo evidence).
-- 3. New criterion: Unit serial number photo added (distinct from the
--    existing "serial/label matches job sheet" check — this one is
--    specifically about photographing the unit's own serial, not the box).
-- 4. Criterion "Functional test recorded..." (the first Job Sheet Evidence
--    item, criterion #11 in the numbered list) renamed to "Commissioning
--    Details Recorded".
-- 5. Criterion "Job sheet completeness..." (#14) deactivated — soft-removed
--    via is_active so historical audits keep their recorded score.
-- 6. audit_submissions gets a sent-flag for the new low-score-to-manager
--    email alert, mirroring the pattern-alert dedup approach.
-- ============================================================================

ALTER TABLE smartfitsinstallationsltd.audit_submission_scores
  DROP CONSTRAINT IF EXISTS audit_submission_scores_score_check;
ALTER TABLE smartfitsinstallationsltd.audit_submission_scores
  ADD CONSTRAINT audit_submission_scores_score_check CHECK (score IN (0, 1, 2, 3));

INSERT INTO smartfitsinstallationsltd.audit_criteria (code, label, category, sort_order, is_active)
VALUES
  ('earth_point_visible', 'Earth point visible', 'photo', 87, true),
  ('unit_serial_photo', 'Unit serial number photo added (not the box serial number)', 'photo', 88, true)
ON CONFLICT (code) DO NOTHING;

UPDATE smartfitsinstallationsltd.audit_criteria
SET label = 'Commissioning details recorded'
WHERE code = 'functional_test';

UPDATE smartfitsinstallationsltd.audit_criteria
SET is_active = false
WHERE code = 'job_sheet_complete';

ALTER TABLE smartfitsinstallationsltd.audit_submissions
  ADD COLUMN IF NOT EXISTS low_score_alert_sent_at timestamptz;
