-- ============================================================================
-- Smartfits Engineer Install Audit — criteria rework + fail threshold
-- Repurposes criteria 11 & 12 to vehicle-condition checks (verifiable from
-- after-photos, so moved into the photo category) and adds a configurable
-- fail_threshold_percent used to flag low-scoring audits on an engineer's
-- profile.
-- ============================================================================

ALTER TABLE smartfitsinstallationsltd.audit_settings
  ADD COLUMN IF NOT EXISTS fail_threshold_percent integer NOT NULL DEFAULT 60
    CHECK (fail_threshold_percent BETWEEN 0 AND 100);

-- Was "Time taken vs SLA" (job_sheet) -> vehicle cleanliness (photo)
UPDATE smartfitsinstallationsltd.audit_criteria
SET code = 'vehicle_cleanliness',
    label = 'Vehicle cleanliness — no wrappers, cable ties, tape, tools or debris left in or on the vehicle',
    category = 'photo',
    sort_order = 85
WHERE code = 'time_vs_sla';

-- Was "Customer sign-off" (job_sheet) -> trim/panels refitted (photo)
UPDATE smartfitsinstallationsltd.audit_criteria
SET code = 'trim_panels_refitted',
    label = 'Trim and panels correctly refitted — no loose, missing, or rattling fixings',
    category = 'photo',
    sort_order = 86
WHERE code = 'customer_signoff';
