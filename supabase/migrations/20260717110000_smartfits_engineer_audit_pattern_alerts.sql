-- ============================================================================
-- Smartfits Engineer Install Audit — recurring pattern email alerts
-- pattern_alert_emails: who gets emailed when a criterion scores "needs
-- action" 3+ times for the same engineer across submitted audits.
-- audit_pattern_alerts: one row per (engineer, criterion) that has ever
-- crossed the threshold — the UNIQUE constraint is what keeps the alert
-- from firing more than once for the same recurring issue.
-- ============================================================================

ALTER TABLE smartfitsinstallationsltd.audit_settings
  ADD COLUMN IF NOT EXISTS pattern_alert_emails text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.audit_pattern_alerts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_employee_id        uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  criterion_id                uuid NOT NULL REFERENCES smartfitsinstallationsltd.audit_criteria(id) ON DELETE CASCADE,
  occurrence_count            integer NOT NULL,
  triggered_by_submission_id  uuid REFERENCES smartfitsinstallationsltd.audit_submissions(id) ON DELETE SET NULL,
  sent_at                     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engineer_employee_id, criterion_id)
);

CREATE INDEX IF NOT EXISTS audit_pattern_alerts_engineer_idx
  ON smartfitsinstallationsltd.audit_pattern_alerts(engineer_employee_id);

ALTER TABLE smartfitsinstallationsltd.audit_pattern_alerts ENABLE ROW LEVEL SECURITY;

-- Read-only from the client — rows are only ever written by the
-- pattern-alert Cloudflare Function using the service-role key, which
-- bypasses RLS entirely, so no INSERT policy is defined here.
CREATE POLICY audit_pattern_alerts_select ON smartfitsinstallationsltd.audit_pattern_alerts
  FOR SELECT USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR smartfitsinstallationsltd.audit_is_any_manager()
  );
