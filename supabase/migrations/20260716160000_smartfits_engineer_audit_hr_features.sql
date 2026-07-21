-- ============================================================================
-- Smartfits Engineer Install Audit — engineer profile HR features
-- Three append-oriented records living alongside audit history:
--   audit_performance_notes    — informal feedback, positive or otherwise
--   audit_disciplinary_actions — formal HR action, Owner/Admin only
--   audit_training_records     — assigned/tracked training & development
-- ============================================================================

-- ----------------------------------------------------------------------------
-- audit_performance_notes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.audit_performance_notes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_employee_id  uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  author_employee_id    uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE SET NULL,
  category              text NOT NULL DEFAULT 'general' CHECK (category IN ('positive', 'concern', 'general')),
  note                  text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_performance_notes_engineer_idx
  ON smartfitsinstallationsltd.audit_performance_notes(engineer_employee_id, created_at DESC);

ALTER TABLE smartfitsinstallationsltd.audit_performance_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_performance_notes_select ON smartfitsinstallationsltd.audit_performance_notes
  FOR SELECT USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR smartfitsinstallationsltd.audit_is_manager_of(engineer_employee_id)
    OR engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
  );

CREATE POLICY audit_performance_notes_insert ON smartfitsinstallationsltd.audit_performance_notes
  FOR INSERT WITH CHECK (
    author_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
    AND (
      smartfitsinstallationsltd.audit_is_owner_or_admin()
      OR smartfitsinstallationsltd.audit_is_manager_of(engineer_employee_id)
    )
  );

CREATE POLICY audit_performance_notes_delete ON smartfitsinstallationsltd.audit_performance_notes
  FOR DELETE USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR author_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
  );

-- ----------------------------------------------------------------------------
-- audit_disciplinary_actions — Owner/Admin only. No UPDATE/DELETE policy is
-- defined, so once logged a record cannot be edited or erased by anyone
-- through the client, matching the same append-only integrity used for
-- submitted audits.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.audit_disciplinary_actions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_employee_id  uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  issued_by_employee_id uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE SET NULL,
  action_type           text NOT NULL CHECK (action_type IN ('verbal_warning', 'written_warning', 'final_warning', 'dismissal', 'other')),
  reason                text NOT NULL,
  outcome               text,
  action_date           date NOT NULL DEFAULT current_date,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_disciplinary_actions_engineer_idx
  ON smartfitsinstallationsltd.audit_disciplinary_actions(engineer_employee_id, action_date DESC);

ALTER TABLE smartfitsinstallationsltd.audit_disciplinary_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_disciplinary_actions_select ON smartfitsinstallationsltd.audit_disciplinary_actions
  FOR SELECT USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
  );

CREATE POLICY audit_disciplinary_actions_insert ON smartfitsinstallationsltd.audit_disciplinary_actions
  FOR INSERT WITH CHECK (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    AND issued_by_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
  );

-- ----------------------------------------------------------------------------
-- audit_training_records
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS smartfitsinstallationsltd.audit_training_records (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_employee_id   uuid NOT NULL REFERENCES public.core_employees(id) ON DELETE CASCADE,
  assigned_by_employee_id uuid REFERENCES public.core_employees(id) ON DELETE SET NULL,
  title                  text NOT NULL,
  status                 text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed')),
  due_date               date,
  completed_date         date,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_training_records_engineer_idx
  ON smartfitsinstallationsltd.audit_training_records(engineer_employee_id, created_at DESC);

DROP TRIGGER IF EXISTS audit_training_records_set_updated_at ON smartfitsinstallationsltd.audit_training_records;
CREATE TRIGGER audit_training_records_set_updated_at BEFORE UPDATE ON smartfitsinstallationsltd.audit_training_records
  FOR EACH ROW EXECUTE FUNCTION smartfitsinstallationsltd.set_updated_at();

ALTER TABLE smartfitsinstallationsltd.audit_training_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_training_records_select ON smartfitsinstallationsltd.audit_training_records
  FOR SELECT USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR smartfitsinstallationsltd.audit_is_manager_of(engineer_employee_id)
    OR engineer_employee_id = smartfitsinstallationsltd.audit_current_employee_id()
  );

CREATE POLICY audit_training_records_write ON smartfitsinstallationsltd.audit_training_records
  FOR ALL USING (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR smartfitsinstallationsltd.audit_is_manager_of(engineer_employee_id)
  ) WITH CHECK (
    smartfitsinstallationsltd.audit_is_owner_or_admin()
    OR smartfitsinstallationsltd.audit_is_manager_of(engineer_employee_id)
  );
