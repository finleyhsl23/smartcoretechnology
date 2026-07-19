import { sb, auditDb } from "./supabase.js";
import { SMARTFITS_COMPANY_ID } from "./auth.js";

const PHOTO_BUCKET = "smartfits-engineer-audit-photos";

// ── Criteria ─────────────────────────────────────────────────────────────
export async function listCriteria() {
  const { data, error } = await auditDb()
    .from("audit_criteria")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw error;
  return data || [];
}

// ── Departments (public.core_departments, scoped to Smartfits) ─────────
export async function listDepartments() {
  const { data, error } = await sb()
    .from("core_departments")
    .select("id, name")
    .eq("company_id", SMARTFITS_COMPANY_ID)
    .order("name");
  if (error) throw error;
  return data || [];
}

// ── Module settings (singleton row) ─────────────────────────────────────
const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

export async function getAuditSettings() {
  const { data, error } = await auditDb()
    .from("audit_settings")
    .select("*")
    .eq("id", SETTINGS_ID)
    .maybeSingle();
  if (error) throw error;
  return data || { id: SETTINGS_ID, visible_department_ids: [], manager_employee_ids: [] };
}

export async function updateAuditSettings(patch, updatedByEmployeeId) {
  const { error } = await auditDb()
    .from("audit_settings")
    .update({ ...patch, updated_by: updatedByEmployeeId })
    .eq("id", SETTINGS_ID);
  if (error) throw error;
}

// ── Employees (identity lives in public.core_employees) ────────────────
export async function listSmartfitsEmployees() {
  const { data, error } = await sb()
    .from("core_employees")
    .select("id, full_name, job_title, department_id, role")
    .eq("company_id", SMARTFITS_COMPANY_ID)
    .order("full_name");
  if (error) throw error;
  return data || [];
}

export async function getEmployeesByIds(ids) {
  if (!ids?.length) return [];
  const { data, error } = await sb()
    .from("core_employees")
    .select("id, full_name, job_title, department_id, role")
    .in("id", [...new Set(ids)]);
  if (error) throw error;
  return data || [];
}

export async function getEmployee(id) {
  const { data, error } = await sb()
    .from("core_employees")
    .select("id, full_name, job_title, department_id, role")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Manager assignments ──────────────────────────────────────────────────
export async function listMyAssignedEngineerIds(managerEmployeeId) {
  const { data, error } = await auditDb()
    .from("audit_manager_assignments")
    .select("engineer_employee_id")
    .eq("manager_employee_id", managerEmployeeId)
    .eq("is_active", true);
  if (error) throw error;
  return (data || []).map(r => r.engineer_employee_id);
}

export async function listAllActiveAssignments() {
  const { data, error } = await auditDb()
    .from("audit_manager_assignments")
    .select("*")
    .eq("is_active", true);
  if (error) throw error;
  return data || [];
}

// Reconciles an engineer's active managers to exactly `desiredManagerIds` —
// deactivates whichever active assignments were unchecked and inserts
// whichever new ones were checked. Supports assigning more than one manager
// to the same engineer at once (shared oversight), since the schema was
// deliberately left without a one-manager-per-engineer constraint.
export async function setEngineerManagers(engineerEmployeeId, desiredManagerIds, assignedByEmployeeId) {
  const { data: current, error: fetchErr } = await auditDb()
    .from("audit_manager_assignments")
    .select("manager_employee_id")
    .eq("engineer_employee_id", engineerEmployeeId)
    .eq("is_active", true);
  if (fetchErr) throw fetchErr;

  const currentIds = (current || []).map(r => r.manager_employee_id);
  const toAdd = desiredManagerIds.filter(id => !currentIds.includes(id));
  const toRemove = currentIds.filter(id => !desiredManagerIds.includes(id));

  if (toRemove.length) {
    const { error } = await auditDb()
      .from("audit_manager_assignments")
      .update({ is_active: false })
      .eq("engineer_employee_id", engineerEmployeeId)
      .in("manager_employee_id", toRemove)
      .eq("is_active", true);
    if (error) throw error;
  }

  if (toAdd.length) {
    const { error } = await auditDb()
      .from("audit_manager_assignments")
      .insert(toAdd.map(managerId => ({
        engineer_employee_id: engineerEmployeeId,
        manager_employee_id: managerId,
        assigned_by: assignedByEmployeeId,
      })));
    if (error) throw error;
  }
}

export async function unassignEngineer(engineerEmployeeId) {
  const { error } = await auditDb()
    .from("audit_manager_assignments")
    .update({ is_active: false })
    .eq("engineer_employee_id", engineerEmployeeId)
    .eq("is_active", true);
  if (error) throw error;
}

// ── Submissions ───────────────────────────────────────────────────────────
export async function listSubmissionsForEngineer(engineerEmployeeId) {
  const { data, error } = await auditDb()
    .from("audit_submissions")
    .select("*")
    .eq("engineer_employee_id", engineerEmployeeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Bulk score rollup for the leaderboard — one request instead of a
// per-engineer, per-submission waterfall. Returns
// { [engineerId]: { total, count, auditCount } }.
export async function listSubmittedScoreTotals(engineerEmployeeIds) {
  if (!engineerEmployeeIds?.length) return {};
  const { data, error } = await auditDb()
    .from("audit_submissions")
    .select("engineer_employee_id, audit_submission_scores(score)")
    .in("engineer_employee_id", engineerEmployeeIds)
    .eq("status", "submitted");
  if (error) throw error;
  const byEngineer = {};
  for (const sub of data || []) {
    const bucket = byEngineer[sub.engineer_employee_id] || (byEngineer[sub.engineer_employee_id] = { total: 0, count: 0, auditCount: 0 });
    bucket.auditCount += 1;
    for (const s of sub.audit_submission_scores || []) {
      bucket.total += s.score;
      bucket.count += 1;
    }
  }
  return byEngineer;
}

export async function getSubmission(id) {
  const { data, error } = await auditDb()
    .from("audit_submissions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createDraftSubmission({ engineer_employee_id, manager_employee_id, job_sheet_text = "", overall_notes = "" }) {
  const { data, error } = await auditDb()
    .from("audit_submissions")
    .insert({ engineer_employee_id, manager_employee_id, job_sheet_text, overall_notes })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateDraftSubmission(id, patch) {
  const { data, error } = await auditDb()
    .from("audit_submissions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function submitSubmission(id) {
  const { data, error } = await auditDb()
    .from("audit_submissions")
    .update({ status: "submitted" })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDraftSubmission(id) {
  const { error } = await auditDb().from("audit_submissions").delete().eq("id", id);
  if (error) throw error;
}

// ── Scores ────────────────────────────────────────────────────────────────
export async function listScores(submissionId) {
  const { data, error } = await auditDb()
    .from("audit_submission_scores")
    .select("*")
    .eq("submission_id", submissionId);
  if (error) throw error;
  return data || [];
}

export async function upsertScore(submissionId, criterionId, score, comment) {
  const { error } = await auditDb()
    .from("audit_submission_scores")
    .upsert(
      { submission_id: submissionId, criterion_id: criterionId, score, comment: comment || null },
      { onConflict: "submission_id,criterion_id" }
    );
  if (error) throw error;
}

// ── Photos ────────────────────────────────────────────────────────────────
export async function listPhotos(submissionId) {
  const { data, error } = await auditDb()
    .from("audit_photos")
    .select("*")
    .eq("submission_id", submissionId)
    .order("uploaded_at");
  if (error) throw error;
  return data || [];
}

export async function uploadPhoto(submissionId, criterionId, file, uploadedByEmployeeId) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${submissionId}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await sb().storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data, error } = await auditDb()
    .from("audit_photos")
    .insert({
      submission_id: submissionId,
      criterion_id: criterionId,
      storage_path: path,
      uploaded_by: uploadedByEmployeeId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPhotoUrl(storagePath) {
  const { data, error } = await sb().storage.from(PHOTO_BUCKET).createSignedUrl(storagePath, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function deletePhoto(photoId, storagePath) {
  await sb().storage.from(PHOTO_BUCKET).remove([storagePath]);
  const { error } = await auditDb().from("audit_photos").delete().eq("id", photoId);
  if (error) throw error;
}

// ── Performance notes ────────────────────────────────────────────────────
export async function listPerformanceNotes(engineerEmployeeId) {
  const { data, error } = await auditDb()
    .from("audit_performance_notes")
    .select("*")
    .eq("engineer_employee_id", engineerEmployeeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addPerformanceNote({ engineer_employee_id, author_employee_id, category, note }) {
  const { error } = await auditDb()
    .from("audit_performance_notes")
    .insert({ engineer_employee_id, author_employee_id, category, note });
  if (error) throw error;
}

export async function deletePerformanceNote(id) {
  const { error } = await auditDb().from("audit_performance_notes").delete().eq("id", id);
  if (error) throw error;
}

// ── Disciplinary actions (Owner/Admin only, append-only) ────────────────
export async function listDisciplinaryActions(engineerEmployeeId) {
  const { data, error } = await auditDb()
    .from("audit_disciplinary_actions")
    .select("*")
    .eq("engineer_employee_id", engineerEmployeeId)
    .order("action_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addDisciplinaryAction({ engineer_employee_id, issued_by_employee_id, action_type, reason, outcome, action_date }) {
  const { error } = await auditDb()
    .from("audit_disciplinary_actions")
    .insert({ engineer_employee_id, issued_by_employee_id, action_type, reason, outcome: outcome || null, action_date });
  if (error) throw error;
}

// ── Training records ─────────────────────────────────────────────────────
export async function listTrainingRecords(engineerEmployeeId) {
  const { data, error } = await auditDb()
    .from("audit_training_records")
    .select("*")
    .eq("engineer_employee_id", engineerEmployeeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addTrainingRecord({ engineer_employee_id, assigned_by_employee_id, title, due_date, notes }) {
  const { error } = await auditDb()
    .from("audit_training_records")
    .insert({ engineer_employee_id, assigned_by_employee_id, title, due_date: due_date || null, notes: notes || null });
  if (error) throw error;
}

export async function updateTrainingRecord(id, patch) {
  const { error } = await auditDb().from("audit_training_records").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTrainingRecord(id) {
  const { error } = await auditDb().from("audit_training_records").delete().eq("id", id);
  if (error) throw error;
}
