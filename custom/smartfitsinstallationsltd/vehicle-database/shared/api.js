import { sb, vdb } from "./supabase.js";
import { SMARTFITS_COMPANY_ID } from "./auth.js";

const PHOTO_BUCKET = "smartfits-vehicle-database-photos";
const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

// Photo uploads are the flakiest thing this app does over a phone's
// connection — one retry after a short pause clears most transient network
// blips without the user having to redo anything.
async function uploadWithRetry(path, file) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await sb().storage.from(PHOTO_BUCKET).upload(path, file, {
      contentType: file.type || "image/jpeg",
      upsert: false,
    });
    if (!error) return;
    if (attempt === 2) throw error;
    await new Promise(r => setTimeout(r, 800));
  }
}

// ── Field + category definitions (shared across every page so the form,
// detail view, and diff view can never drift out of sync) ──────────────────
export const PHOTO_CATEGORIES = [
  { key: "front",                label: "Front of Vehicle" },
  { key: "back",                 label: "Back of Vehicle" },
  { key: "ignition_wire",        label: "Ignition Wire Location" },
  { key: "permanent_wire",       label: "Permanent Wire Location" },
  { key: "fms_plug",             label: "FMS Plug Location" },
  { key: "earth_point",          label: "Earth Point" },
  { key: "airbag",               label: "Airbag Location" },
  { key: "adas_camera",          label: "ADAS Camera Position" },
  { key: "dashcam_mounting",     label: "Dashcam Mounting Location" },
  { key: "tracker_mounting",     label: "Tracker Mounting Location" },
  { key: "lightfoot_driver_id",  label: "Lightfoot Driver ID Location" },
  { key: "lightfoot_bp_button",  label: "Lightfoot B&P Button Location" },
  { key: "general",              label: "General / Other" },
];

// A vehicle's body variant matters because a facelift usually changes the
// front/rear styling — the front/back photos taken alongside it only really
// make sense once you know which variant they're showing.
export const BODY_VARIANTS = [
  { key: "standard", label: "Standard" },
  { key: "facelift", label: "Facelift" },
];

// What's being fitted — wiring and component locations genuinely differ by
// this, the same way they differ by Body Variant, so it's required at
// creation and searchable alongside make/model/year.
export const FITMENT_TYPES = [
  { key: "obd_tracker",                label: "OBD Tracker" },
  { key: "lightfoot",                  label: "Lightfoot" },
  { key: "three_wire_tracker_camera",  label: "3 Wire Tracker/Camera" },
];

export const FIELD_GROUPS = [
  {
    title: "Vehicle Identity",
    color: "blue",
    fields: [
      { key: "registration",        label: "Registration", required: true },
      { key: "make",                label: "Make" },
      { key: "model",               label: "Model" },
      { key: "year_of_manufacture", label: "Year", type: "number" },
      { key: "fuel_type",           label: "Fuel Type" },
    ],
  },
  {
    title: "Wiring & Electrical",
    color: "amber",
    fields: [
      { key: "ignition_wire_colour",   label: "Ignition Wire Colour" },
      { key: "ignition_wire_location", label: "Ignition Wire — Exact Location", type: "textarea", photoCategory: "ignition_wire" },
      { key: "fuse_tap_options",       label: "Permanent Wire — Exact Location", type: "textarea", photoCategory: "permanent_wire" },
      { key: "fms_plug_location",      label: "FMS Plug Location", type: "textarea", photoCategory: "fms_plug" },
      { key: "can_high_colour",        label: "CAN High Colour" },
      { key: "can_low_colour",         label: "CAN Low Colour" },
      { key: "earth_point_location",   label: "Earth Point Location", type: "textarea", photoCategory: "earth_point" },
    ],
  },
  {
    title: "Component Placement",
    color: "purple",
    fields: [
      { key: "airbag_location",              label: "Airbag Location(s)", type: "textarea", photoCategory: "airbag" },
      { key: "adas_camera_position",         label: "ADAS Camera Position", type: "textarea", photoCategory: "adas_camera" },
      { key: "dashcam_mounting_location",    label: "Best Dashcam Mounting Location", type: "textarea", photoCategory: "dashcam_mounting" },
      { key: "tracker_mounting_location",    label: "Best Tracker Mounting Location", type: "textarea", photoCategory: "tracker_mounting" },
      { key: "lightfoot_driver_id_location", label: "Lightfoot — Driver ID Location", type: "textarea", photoCategory: "lightfoot_driver_id" },
      { key: "lightfoot_bp_button_location", label: "Lightfoot — B&P Button Exact Location", type: "textarea", photoCategory: "lightfoot_bp_button" },
    ],
  },
  {
    title: "Install Notes",
    color: "teal",
    fields: [
      { key: "installation_time", label: "Installation Time" },
      { key: "special_notes",     label: "Special Notes", type: "textarea" },
    ],
  },
];

export const ALL_FIELD_KEYS = FIELD_GROUPS.flatMap(g => g.fields.map(f => f.key));

export function fieldLabel(key) {
  if (key === "body_variant") return "Body Variant";
  if (key === "fitment_type") return "Fitment";
  for (const g of FIELD_GROUPS) {
    const f = g.fields.find(x => x.key === key);
    if (f) return f.label;
  }
  return key;
}

export function categoryLabel(key) {
  return PHOTO_CATEGORIES.find(c => c.key === key)?.label || key;
}

// Which photo category (if any) a field is paired with, so a field's photos
// can be shown right alongside it instead of in a separate, disconnected
// gallery.
export function fieldPhotoCategory(key) {
  for (const g of FIELD_GROUPS) {
    const f = g.fields.find(x => x.key === key);
    if (f?.photoCategory) return f.photoCategory;
  }
  return null;
}

export function normalizeReg(reg) {
  return String(reg || "").toUpperCase().replace(/\s+/g, "");
}

// ── Employees (identity lives in public.core_employees) ─────────────────
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

// ── Module settings (singleton row) ─────────────────────────────────────
export async function getSettings() {
  const { data, error } = await vdb()
    .from("vdb_settings")
    .select("*")
    .eq("id", SETTINGS_ID)
    .maybeSingle();
  if (error) throw error;
  return data || { id: SETTINGS_ID, manager_employee_ids: [] };
}

export async function updateSettings(patch, updatedByEmployeeId) {
  const { error } = await vdb()
    .from("vdb_settings")
    .update({ ...patch, updated_by: updatedByEmployeeId })
    .eq("id", SETTINGS_ID);
  if (error) throw error;
}

// ── Vehicles ──────────────────────────────────────────────────────────────
export async function searchVehicles(query) {
  const q = (query || "").trim();
  let builder = vdb().from("vdb_vehicles").select("*").order("updated_at", { ascending: false });
  if (q) {
    const regNorm = normalizeReg(q);
    builder = builder.or(
      `registration_norm.ilike.%${regNorm}%,vin.ilike.%${q}%,make.ilike.%${q}%,model.ilike.%${q}%`
    );
  }
  const { data, error } = await builder.limit(200);
  if (error) throw error;
  return data || [];
}

export async function listRecentVehicles(limit = 20) {
  const { data, error } = await vdb()
    .from("vdb_vehicles")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getVehicle(id) {
  const { data, error } = await vdb()
    .from("vdb_vehicles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Checks the registrations log first — this covers every plate ever logged
// against a profile, not just each vehicle's own primary registration — and
// falls back to a direct check on vdb_vehicles for the rare case a vehicle's
// own reg hasn't made it into the log yet.
export async function getVehicleByRegistration(reg) {
  const norm = normalizeReg(reg);
  const { data: regRow, error: regErr } = await vdb()
    .from("vdb_vehicle_registrations")
    .select("vehicle_id")
    .eq("registration_norm", norm)
    .maybeSingle();
  if (regErr) throw regErr;
  if (regRow) return getVehicle(regRow.vehicle_id);

  const { data, error } = await vdb()
    .from("vdb_vehicles")
    .select("*")
    .eq("registration_norm", norm)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Known registrations log (one vehicle profile can cover several plates
// bought as an identical fleet batch) ────────────────────────────────────
export async function listVehicleRegistrations(vehicleId) {
  const { data, error } = await vdb()
    .from("vdb_vehicle_registrations")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .order("added_at");
  if (error) throw error;
  return data || [];
}

export async function addVehicleRegistration(vehicleId, registration, addedByEmployeeId) {
  const { data, error } = await vdb()
    .from("vdb_vehicle_registrations")
    .insert({ vehicle_id: vehicleId, registration: registration.trim().toUpperCase(), added_by: addedByEmployeeId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeVehicleRegistration(id) {
  const { error } = await vdb().from("vdb_vehicle_registrations").delete().eq("id", id);
  if (error) throw error;
}

// ── Install points (some vehicles have more than one pickup/mounting point —
// a free-form repeatable list alongside the fixed location fields) ─────────
export async function listInstallPoints(vehicleId) {
  const { data, error } = await vdb()
    .from("vdb_install_points")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .order("created_at");
  if (error) throw error;
  return data || [];
}

export async function createInstallPoint(vehicleId, { label, description }, createdByEmployeeId) {
  const { data, error } = await vdb()
    .from("vdb_install_points")
    .insert({ vehicle_id: vehicleId, label: label.trim(), description: description?.trim() || null, created_by: createdByEmployeeId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteInstallPoint(id) {
  const { error } = await vdb().from("vdb_install_points").delete().eq("id", id);
  if (error) throw error;
}

export async function listInstallPointPhotos(installPointId) {
  const { data, error } = await vdb()
    .from("vdb_install_point_photos")
    .select("*")
    .eq("install_point_id", installPointId)
    .order("uploaded_at");
  if (error) throw error;
  return data || [];
}

// Stored under the same '<vehicle_id>/...' prefix as every other approved
// vehicle photo (just nested under points/<install_point_id>/) so it's
// covered by the existing storage policies with no changes needed there.
export async function uploadInstallPointPhoto(vehicleId, installPointId, file, uploadedByEmployeeId) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${vehicleId}/points/${installPointId}/${crypto.randomUUID()}.${ext}`;

  await uploadWithRetry(path, file);

  const { data, error } = await vdb()
    .from("vdb_install_point_photos")
    .insert({ install_point_id: installPointId, storage_path: path, uploaded_by: uploadedByEmployeeId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteInstallPointPhoto(photoId, storagePath) {
  await sb().storage.from(PHOTO_BUCKET).remove([storagePath]);
  const { error } = await vdb().from("vdb_install_point_photos").delete().eq("id", photoId);
  if (error) throw error;
}

export async function searchVehiclesByMakeModelYear({ make, model, year, fitmentType } = {}) {
  let builder = vdb().from("vdb_vehicles").select("*").order("updated_at", { ascending: false });
  if (make) builder = builder.ilike("make", `%${make.trim()}%`);
  if (model) builder = builder.ilike("model", `%${model.trim()}%`);
  if (year) builder = builder.eq("year_of_manufacture", Number(year));
  if (fitmentType) builder = builder.eq("fitment_type", fitmentType);
  const { data, error } = await builder.limit(50);
  if (error) throw error;
  return data || [];
}

export async function createVehicle(patch, createdByEmployeeId) {
  const normalizedPatch = patch.registration ? { ...patch, registration: patch.registration.trim().toUpperCase() } : patch;
  const { data, error } = await vdb()
    .from("vdb_vehicles")
    .insert({ ...normalizedPatch, created_by: createdByEmployeeId, updated_by: createdByEmployeeId })
    .select()
    .single();
  if (error) throw error;
  try {
    await addVehicleRegistration(data.id, data.registration, createdByEmployeeId);
  } catch { /* non-fatal — getVehicleByRegistration falls back to vdb_vehicles directly */ }
  return data;
}

export async function updateVehicle(id, patch, updatedByEmployeeId) {
  const normalizedPatch = patch.registration ? { ...patch, registration: patch.registration.trim().toUpperCase() } : patch;
  const { data, error } = await vdb()
    .from("vdb_vehicles")
    .update({ ...normalizedPatch, updated_by: updatedByEmployeeId })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteVehicle(id) {
  const { error } = await vdb().from("vdb_vehicles").delete().eq("id", id);
  if (error) throw error;
}

// ── Vehicle photos (approved, attached directly) ────────────────────────
export async function listVehiclePhotos(vehicleId) {
  const { data, error } = await vdb()
    .from("vdb_vehicle_photos")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .order("uploaded_at");
  if (error) throw error;
  return data || [];
}

export async function uploadVehiclePhoto(vehicleId, category, file, uploadedByEmployeeId, caption = "") {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${vehicleId}/${crypto.randomUUID()}.${ext}`;

  await uploadWithRetry(path, file);

  const { data, error } = await vdb()
    .from("vdb_vehicle_photos")
    .insert({ vehicle_id: vehicleId, category, storage_path: path, uploaded_by: uploadedByEmployeeId, caption: caption || null })
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

export async function deleteVehiclePhoto(photoId, storagePath) {
  await sb().storage.from(PHOTO_BUCKET).remove([storagePath]);
  const { error } = await vdb().from("vdb_vehicle_photos").delete().eq("id", photoId);
  if (error) throw error;
}

// ── Edit requests ─────────────────────────────────────────────────────────
export async function listEditRequests({ status } = {}) {
  let builder = vdb().from("vdb_edit_requests").select("*").order("created_at", { ascending: false });
  if (status) builder = builder.eq("status", status);
  const { data, error } = await builder;
  if (error) throw error;
  return data || [];
}

// Does a pending "new_vehicle" suggestion already match this search? Used so
// a search that finds nothing in vdb_vehicles can point the searcher at an
// existing pending suggestion instead of inviting an exact duplicate.
// `requests` should come from listEditRequests({status:"pending"}) — RLS
// already scopes that to every pending request for a manager, or only the
// caller's own for a regular employee, so this needs no role branching.
export function findPendingNewVehicleMatch(requests, { registration, make, model, year } = {}) {
  const pending = requests.filter(r => r.request_type === "new_vehicle" && r.status === "pending");
  if (registration) {
    const norm = normalizeReg(registration);
    const byReg = pending.find(r => normalizeReg(r.proposed_changes?.registration || "") === norm);
    if (byReg) return byReg;
  }
  if (make || model || year) {
    return pending.find(r => {
      const pc = r.proposed_changes || {};
      return (!make || (pc.make || "").toLowerCase() === make.toLowerCase())
        && (!model || (pc.model || "").toLowerCase() === model.toLowerCase())
        && (!year || String(pc.year_of_manufacture || "") === String(year));
    }) || null;
  }
  return null;
}

export async function listMyEditRequests(employeeId) {
  const { data, error } = await vdb()
    .from("vdb_edit_requests")
    .select("*")
    .eq("requested_by", employeeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listEditRequestsForVehicle(vehicleId) {
  const { data, error } = await vdb()
    .from("vdb_edit_requests")
    .select("*")
    .eq("vehicle_id", vehicleId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getEditRequest(id) {
  const { data, error } = await vdb()
    .from("vdb_edit_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createEditRequest({ vehicle_id, requested_by, proposed_changes, request_note = "" }) {
  const { data, error } = await vdb()
    .from("vdb_edit_requests")
    .insert({ vehicle_id, requested_by, proposed_changes, request_note: request_note || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Suggesting a brand new vehicle (not editing an existing one) — an employee
// can't insert into vdb_vehicles directly (that requires manager tier), so
// this goes through the same review queue as a field-edit request, just with
// no vehicle_id yet and the full vehicle carried in proposed_changes.
// approveEditRequest() creates the real vdb_vehicles row once accepted.
export async function createNewVehicleRequest({ requested_by, proposed_changes, request_note = "" }) {
  const { data, error } = await vdb()
    .from("vdb_edit_requests")
    .insert({ vehicle_id: null, request_type: "new_vehicle", requested_by, proposed_changes, request_note: request_note || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function withdrawEditRequest(id) {
  const { error } = await vdb().from("vdb_edit_requests").delete().eq("id", id);
  if (error) throw error;
}

export async function listRequestPhotos(requestId) {
  const { data, error } = await vdb()
    .from("vdb_edit_request_photos")
    .select("*")
    .eq("request_id", requestId)
    .order("uploaded_at");
  if (error) throw error;
  return data || [];
}

export async function uploadRequestPhoto(requestId, category, file, caption = "") {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `pending/${requestId}/${crypto.randomUUID()}.${ext}`;

  await uploadWithRetry(path, file);

  const { data, error } = await vdb()
    .from("vdb_edit_request_photos")
    .insert({ request_id: requestId, category, storage_path: path, caption: caption || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRequestPhoto(photoId, storagePath) {
  await sb().storage.from(PHOTO_BUCKET).remove([storagePath]);
  const { error } = await vdb().from("vdb_edit_request_photos").delete().eq("id", photoId);
  if (error) throw error;
}

/**
 * Approves an edit request. For a field-edit request, applies the proposed
 * patch to the existing vehicle. For a new-vehicle request (request_type ===
 * "new_vehicle", vehicle_id null) creates the vehicle for the first time —
 * this is the only path an employee's vehicle suggestion can ever actually
 * land in vdb_vehicles, since inserting there directly requires manager
 * tier. Either way, any proposed photos are re-parented from their pending/
 * storage path to the vehicle's permanent path, and the request row is
 * stamped approved (with vehicle_id backfilled for new-vehicle requests, so
 * "My Suggested Changes" can link straight to the resulting profile). Runs
 * entirely under the calling manager's own RLS rights — no elevated RPC
 * needed.
 */
export async function approveEditRequest(request, reviewerEmployeeId, reviewNote = "") {
  let vehicleId = request.vehicle_id;

  if (request.request_type === "new_vehicle") {
    const created = await createVehicle(request.proposed_changes || {}, reviewerEmployeeId);
    vehicleId = created.id;
  } else if (Object.keys(request.proposed_changes || {}).length) {
    await updateVehicle(request.vehicle_id, request.proposed_changes, reviewerEmployeeId);
  }

  const photos = await listRequestPhotos(request.id);
  for (const photo of photos) {
    const ext = (photo.storage_path.split(".").pop() || "jpg").toLowerCase();
    const newPath = `${vehicleId}/${crypto.randomUUID()}.${ext}`;
    const { error: moveErr } = await sb().storage.from(PHOTO_BUCKET).move(photo.storage_path, newPath);
    if (moveErr) throw moveErr;

    const { error: insErr } = await vdb().from("vdb_vehicle_photos").insert({
      vehicle_id: vehicleId,
      category: photo.category,
      storage_path: newPath,
      caption: photo.caption,
      uploaded_by: request.requested_by,
    });
    if (insErr) throw insErr;
  }

  const { error } = await vdb()
    .from("vdb_edit_requests")
    .update({ status: "approved", reviewed_by: reviewerEmployeeId, review_note: reviewNote || null, vehicle_id: vehicleId })
    .eq("id", request.id);
  if (error) throw error;
}

export async function denyEditRequest(requestId, reviewerEmployeeId, reviewNote = "") {
  const { error } = await vdb()
    .from("vdb_edit_requests")
    .update({ status: "denied", reviewed_by: reviewerEmployeeId, review_note: reviewNote || null })
    .eq("id", requestId);
  if (error) throw error;
}

// ── Registration lookup — DVSA MOT History API, server-side proxy (see
// functions/api/smartfits-vehicle-database/registration-lookup.js) ──────
export async function lookupRegistration(registration) {
  const { data: sessionData } = await sb().auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const res = await fetch("/api/smartfits-vehicle-database/registration-lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ registration: normalizeReg(registration) }),
  });
  const body = await res.json();
  if (!res.ok || body.error) {
    const err = new Error(body.error || "Lookup failed");
    err.status = res.status;
    throw err;
  }
  return body;
}

// ── Leaderboard — most vehicle change requests submitted ────────────────
// Calls a SECURITY DEFINER aggregate function rather than querying
// vdb_edit_requests directly: that table's own RLS only lets an employee see
// their own requests (plus managers seeing everything), which isn't enough
// to power a leaderboard everyone can see. Returns [{ employee_id, request_count }].
export async function listChangeRequestLeaderboard() {
  const { data, error } = await vdb().rpc("vdb_change_request_leaderboard");
  if (error) throw error;
  return data || [];
}

// ── Approval leaderboard — ranks managers/admins by how many requests
// they've approved, so review workload doesn't quietly pile onto one person.
// Same SECURITY DEFINER pattern as above. Returns [{ employee_id, approval_count }].
export async function listApprovalLeaderboard() {
  const { data, error } = await vdb().rpc("vdb_approval_leaderboard");
  if (error) throw error;
  return data || [];
}
