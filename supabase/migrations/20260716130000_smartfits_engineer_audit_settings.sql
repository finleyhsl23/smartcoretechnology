-- ============================================================================
-- Smartfits Engineer Install Audit — module settings
-- Single-row settings table: which core_departments should be offered in the
-- "which engineer would you like to audit" picker. An empty array means
-- "show everyone" (unrestricted, matching the picker's original default).
-- ============================================================================

CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.audit_settings (
  id                      uuid PRIMARY KEY DEFAULT '00000000-0000-0000-0000-000000000001',
  visible_department_ids  uuid[] NOT NULL DEFAULT '{}',
  updated_by              uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS audit_settings_set_updated_at ON smartfitsinstallationsltd.audit_settings;
CREATE TRIGGER audit_settings_set_updated_at BEFORE UPDATE ON smartfitsinstallationsltd.audit_settings
  FOR EACH ROW EXECUTE FUNCTION smartfitsinstallationsltd.set_updated_at();

ALTER TABLE smartfitsinstallationsltd.audit_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_settings_select ON smartfitsinstallationsltd.audit_settings
  FOR SELECT USING (smartfitsinstallationsltd.audit_current_employee_id() IS NOT NULL);

CREATE POLICY audit_settings_write_admin ON smartfitsinstallationsltd.audit_settings
  FOR ALL USING (smartfitsinstallationsltd.audit_is_owner_or_admin())
  WITH CHECK (smartfitsinstallationsltd.audit_is_owner_or_admin());

INSERT INTO smartfitsinstallationsltd.audit_settings (id)
VALUES ('00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;
