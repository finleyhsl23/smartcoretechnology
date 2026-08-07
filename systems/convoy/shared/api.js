import { sb } from "./supabase.js";

const BUCKET = "convoy-media";

async function uploadPhoto(companyId, folder, entityId, blob) {
  const id = crypto.randomUUID();
  const path = `${companyId}/${folder}/${entityId}/${id}.jpg`;
  const { error } = await sb().storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

export async function signedUrl(path, expiresIn = 3600) {
  if (!path) return null;
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl || null;
}

// ── Settings ────────────────────────────────────────────────────────────
export const settings = {
  async get(companyId) {
    const { data, error } = await sb().rpc("convoy_ensure_settings", { p_company_id: companyId });
    if (error) throw error;
    return data;
  },
  async update(companyId, patch) {
    const { data, error } = await sb().from("convoy_settings").update(patch).eq("company_id", companyId).select("*").single();
    if (error) throw error;
    return data;
  },
};

// ── Vehicles ────────────────────────────────────────────────────────────
export const vehicles = {
  async list(companyId, { status } = {}) {
    let q = sb().from("convoy_vehicles").select("*, driver:assigned_driver_id(id, full_name)").eq("company_id", companyId).order("registration");
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async get(id) {
    const { data, error } = await sb().from("convoy_vehicles").select("*, driver:assigned_driver_id(id, full_name)").eq("id", id).single();
    if (error) throw error;
    return data;
  },
  async create(companyId, employeeId, payload) {
    const { data, error } = await sb().from("convoy_vehicles").insert({ ...payload, company_id: companyId, created_by: employeeId }).select("*").single();
    if (error) throw error;
    return data;
  },
  async update(id, patch) {
    const { data, error } = await sb().from("convoy_vehicles").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    return data;
  },
  async uploadPhoto(companyId, vehicleId, blob) {
    const path = await uploadPhoto(companyId, "vehicles", vehicleId, blob);
    await vehicles.update(vehicleId, { photo_storage_path: path });
    return path;
  },
  async complianceDue(companyId, withinDays = 30) {
    const cutoff = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
    const { data, error } = await sb()
      .from("convoy_vehicles")
      .select("*")
      .eq("company_id", companyId)
      .neq("status", "retired")
      .or(`mot_due.lte.${cutoff},tax_due.lte.${cutoff},insurance_due.lte.${cutoff},service_due.lte.${cutoff}`);
    if (error) throw error;
    return data || [];
  },
};

// ── Driver licences ─────────────────────────────────────────────────────
export const drivers = {
  async list(companyId) {
    const { data, error } = await sb()
      .from("convoy_driver_licences")
      .select("*, employee:employee_id(id, full_name, work_email)")
      .eq("company_id", companyId);
    if (error) throw error;
    return data || [];
  },
  async upsert(companyId, employeeId, checkedBy, payload) {
    const { data, error } = await sb()
      .from("convoy_driver_licences")
      .upsert({ ...payload, company_id: companyId, employee_id: employeeId, last_checked_at: new Date().toISOString(), last_checked_by: checkedBy }, { onConflict: "company_id,employee_id" })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
  async listCompanyEmployees(companyId) {
    const { data, error } = await sb().from("core_employees").select("id, full_name, work_email").eq("company_id", companyId).order("full_name");
    if (error) throw error;
    return data || [];
  },
};

// ── Checklist templates ─────────────────────────────────────────────────
export const checklists = {
  async list(companyId) {
    const { data, error } = await sb().from("convoy_checklist_templates").select("*, items:convoy_checklist_template_items(*)").eq("company_id", companyId).order("created_at");
    if (error) throw error;
    return (data || []).map(t => ({ ...t, items: (t.items || []).sort((a, b) => a.sort_order - b.sort_order) }));
  },
  async get(id) {
    const { data, error } = await sb().from("convoy_checklist_templates").select("*, items:convoy_checklist_template_items(*)").eq("id", id).single();
    if (error) throw error;
    data.items = (data.items || []).sort((a, b) => a.sort_order - b.sort_order);
    return data;
  },
  async ensureDefault(companyId, employeeId) {
    const existing = await checklists.list(companyId);
    if (existing.length) return existing;
    const { error } = await sb().rpc("convoy_seed_default_template", { p_company_id: companyId, p_created_by: employeeId });
    if (error) throw error;
    return checklists.list(companyId);
  },
  async create(companyId, employeeId, payload) {
    const { data, error } = await sb().from("convoy_checklist_templates").insert({ ...payload, company_id: companyId, created_by: employeeId }).select("*").single();
    if (error) throw error;
    return data;
  },
  async update(id, patch) {
    const { error } = await sb().from("convoy_checklist_templates").update(patch).eq("id", id);
    if (error) throw error;
  },
  async addItem(templateId, payload) {
    const { data, error } = await sb().from("convoy_checklist_template_items").insert({ ...payload, template_id: templateId }).select("*").single();
    if (error) throw error;
    return data;
  },
  async updateItem(id, patch) {
    const { error } = await sb().from("convoy_checklist_template_items").update(patch).eq("id", id);
    if (error) throw error;
  },
  async deleteItem(id) {
    const { error } = await sb().from("convoy_checklist_template_items").delete().eq("id", id);
    if (error) throw error;
  },
};

// ── Vehicle checks (the walkaround flow) ────────────────────────────────
export const checks = {
  async findActive(driverEmployeeId, vehicleId) {
    const { data, error } = await sb()
      .from("convoy_vehicle_checks")
      .select("*, items:convoy_check_items(*)")
      .eq("driver_employee_id", driverEmployeeId)
      .eq("vehicle_id", vehicleId)
      .eq("status", "in_progress")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) data.items = (data.items || []).sort((a, b) => a.sort_order - b.sort_order);
    return data;
  },
  async start({ companyId, vehicleId, driverEmployeeId, templateId, checkType, mileage, start }) {
    const { data: check, error } = await sb()
      .from("convoy_vehicle_checks")
      .insert({
        company_id: companyId,
        vehicle_id: vehicleId,
        driver_employee_id: driverEmployeeId,
        template_id: templateId,
        check_type: checkType,
        mileage: mileage || null,
        start_latitude: start?.latitude ?? null,
        start_longitude: start?.longitude ?? null,
        start_accuracy_m: start?.accuracy ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    const template = await checklists.get(templateId);
    const rows = template.items.map(it => ({
      check_id: check.id,
      label: it.label,
      zone: it.zone,
      sort_order: it.sort_order,
      requires_photo: it.requires_photo,
    }));
    const { data: items, error: itemsErr } = await sb().from("convoy_check_items").insert(rows).select("*");
    if (itemsErr) throw itemsErr;

    check.items = (items || []).sort((a, b) => a.sort_order - b.sort_order);
    return check;
  },
  async get(id) {
    const { data, error } = await sb()
      .from("convoy_vehicle_checks")
      .select("*, vehicle:vehicle_id(*), driver:driver_employee_id(id, full_name), items:convoy_check_items(*, photo:photo_id(*))")
      .eq("id", id)
      .single();
    if (error) throw error;
    data.items = (data.items || []).sort((a, b) => a.sort_order - b.sort_order);
    return data;
  },
  async listForCompany(companyId, { vehicleId, driverEmployeeId, limit = 50 } = {}) {
    let q = sb()
      .from("convoy_vehicle_checks")
      .select("*, vehicle:vehicle_id(registration, make, model), driver:driver_employee_id(id, full_name)")
      .eq("company_id", companyId)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(limit);
    if (vehicleId) q = q.eq("vehicle_id", vehicleId);
    if (driverEmployeeId) q = q.eq("driver_employee_id", driverEmployeeId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async uploadItemPhoto(companyId, checkId, itemId, capture, geo) {
    const path = await uploadPhoto(companyId, "checks", checkId, capture.blob);
    const { data: photo, error } = await sb()
      .from("convoy_check_photos")
      .insert({
        check_id: checkId,
        storage_path: path,
        latitude: geo?.latitude ?? null,
        longitude: geo?.longitude ?? null,
        accuracy_m: geo?.accuracy ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    const { error: itemErr } = await sb().from("convoy_check_items").update({ photo_id: photo.id }).eq("id", itemId);
    if (itemErr) throw itemErr;
    return photo;
  },
  async setItemResult(itemId, { passed, notes }) {
    const { error } = await sb().from("convoy_check_items").update({ passed, notes: notes || null, completed_at: new Date().toISOString() }).eq("id", itemId);
    if (error) throw error;
  },
  async submit(checkId, { latitude, longitude, accuracy, attestedName }) {
    const { data, error } = await sb().rpc("convoy_submit_check", {
      p_check_id: checkId,
      p_end_latitude: latitude ?? null,
      p_end_longitude: longitude ?? null,
      p_end_accuracy_m: accuracy ?? null,
      p_driver_attested_name: attestedName,
    });
    if (error) throw error;
    return data;
  },
};

// ── Defects ─────────────────────────────────────────────────────────────
export const defects = {
  async list(companyId, { status, vehicleId } = {}) {
    let q = sb()
      .from("convoy_defects")
      .select("*, vehicle:vehicle_id(registration, make, model), reporter:reported_by(full_name), assignee:assigned_to(full_name)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (status) q = q.eq("status", status);
    if (vehicleId) q = q.eq("vehicle_id", vehicleId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async get(id) {
    const { data, error } = await sb()
      .from("convoy_defects")
      .select("*, vehicle:vehicle_id(*), reporter:reported_by(full_name), assignee:assigned_to(full_name), photos:convoy_defect_photos(*), source_item:source_check_item_id(*, photo:photo_id(*)), comments:convoy_defect_comments(*, author:author_employee_id(full_name))")
      .eq("id", id)
      .single();
    if (error) throw error;
    data.comments = (data.comments || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return data;
  },
  async create(companyId, reportedBy, payload) {
    const { data, error } = await sb().from("convoy_defects").insert({ ...payload, company_id: companyId, reported_by: reportedBy }).select("*").single();
    if (error) throw error;
    return data;
  },
  async update(id, patch) {
    const { data, error } = await sb().from("convoy_defects").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    return data;
  },
  async resolve(id, resolvedBy, resolutionNotes) {
    return defects.update(id, { status: "resolved", resolved_by: resolvedBy, resolved_at: new Date().toISOString(), resolution_notes: resolutionNotes || null });
  },
  async addComment(defectId, authorId, body) {
    const { data, error } = await sb().from("convoy_defect_comments").insert({ defect_id: defectId, author_employee_id: authorId, body }).select("*").single();
    if (error) throw error;
    return data;
  },
  async uploadPhoto(companyId, defectId, blob, geo) {
    const path = await uploadPhoto(companyId, "defects", defectId, blob);
    const { data, error } = await sb()
      .from("convoy_defect_photos")
      .insert({ defect_id: defectId, storage_path: path, latitude: geo?.latitude ?? null, longitude: geo?.longitude ?? null })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
};

// ── Dashboard ───────────────────────────────────────────────────────────
export const dashboard = {
  async stats(companyId) {
    const [vehicleList, openDefects, dueSoon, checkedToday] = await Promise.all([
      vehicles.list(companyId),
      defects.list(companyId, { status: "open" }),
      vehicles.complianceDue(companyId, 30),
      checks.listForCompany(companyId, { limit: 200 }).then(rows => rows.filter(r => (r.submitted_at || "").slice(0, 10) === new Date().toISOString().slice(0, 10))),
    ]);
    return {
      totalVehicles: vehicleList.length,
      activeVehicles: vehicleList.filter(v => v.status === "active").length,
      vorVehicles: vehicleList.filter(v => v.status === "vor"),
      openDefects,
      dueSoon,
      checkedTodayVehicleIds: new Set(checkedToday.map(c => c.vehicle_id)),
    };
  },
};
