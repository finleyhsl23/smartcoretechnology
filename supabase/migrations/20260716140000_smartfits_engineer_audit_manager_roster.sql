-- ============================================================================
-- Smartfits Engineer Install Audit — Senior Regional Engineering Manager roster
-- Adds a curated list of employees who may be picked as a manager when
-- assigning engineers. Membership here also counts as "manager" tier at
-- login, even before any engineer has been assigned to them yet.
-- ============================================================================

ALTER TABLE smartfitsinstallationsltd.audit_settings
  ADD COLUMN IF NOT EXISTS manager_employee_ids uuid[] NOT NULL DEFAULT '{}';
