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
  return data || { id: SETTINGS_ID, visible_department_ids: [] };
}

export async function updateVisibleDepartments(departmentIds, updatedByEmployeeId) {
  const { error } = await auditDb()
    .from("audit_settings")
    .update({ visible_department_ids: departmentIds, updated_by: updatedByEmployeeId })
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

export async function getAssignedManagerId(engineerEmployeeId) {
  const { data, error } = await auditDb()
    .from("audit_manager_assignments")
    .select("manager_employee_id")
    .eq("engineer_employee_id", engineerEmployeeId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.manager_employee_id || null;
}

// Deactivates any existing active assignment for this engineer, then creates
// a new one. Kept as two ops (not a hard DB constraint) so this stays
// configurable rather than a rigid one-manager-per-engineer rule.
export async function assignEngineer(engineerEmployeeId, managerEmployeeId, assignedByEmployeeId) {
  const { error: deactErr } = await auditDb()
    .from("audit_manager_assignments")
    .update({ is_active: false })
    .eq("engineer_employee_id", engineerEmployeeId)
    .eq("is_active", true);
  if (deactErr) throw deactErr;

  const { error } = await auditDb()
    .from("audit_manager_assignments")
    .insert({
      engineer_employee_id: engineerEmployeeId,
      manager_employee_id: managerEmployeeId,
      assigned_by: assignedByEmployeeId,
    });
  if (error) throw error;
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
