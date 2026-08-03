import { sb, vdb } from "./supabase.js";
import { SMARTFITS_COMPANY_ID } from "./auth.js";

const PHOTO_BUCKET = "smartfits-vehicle-database-photos";
const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

// ── Field + category definitions (shared across every page so the form,
// detail view, and diff view can never drift out of sync) ──────────────────
export const PHOTO_CATEGORIES = [
  { key: "front",              label: "Front of Vehicle" },
  { key: "back",               label: "Back of Vehicle" },
  { key: "ignition_wire",      label: "Ignition Wire Location" },
  { key: "earth_point",        label: "Earth Point" },
  { key: "airbag",             label: "Airbag Location" },
  { key: "adas_camera",        label: "ADAS Camera Position" },
  { key: "dashcam_mounting",   label: "Dashcam Mounting Location" },
  { key: "tracker_mounting",   label: "Tracker Mounting Location" },
  { key: "general",            label: "General / Other" },
];

// A vehicle's body variant matters because a facelift usually changes the
// front/rear styling — the front/back photos taken alongside it only really
// make sense once you know which variant they're showing.
export const BODY_VARIANTS = [
  { key: "standard", label: "Standard" },
  { key: "facelift", label: "Facelift" },
];

export const FIELD_GROUPS = [
  {
    title: "Vehicle Identity",
    color: "blue",
    fields: [
      { key: "registration",        label: "Registration", required: true },
      { key: "vin",                 label: "VIN" },
      { key: "make",                label: "Make" },
      { key: "model",               label: "Model" },
      { key: "year_of_manufacture", label: "Year", type: "number" },
      { key: "colour",              label: "Colour" },
      { key: "fuel_type",           label: "Fuel Type" },
    ],
  },
  {
    title: "Wiring & Electrical",
    color: "amber",
    fields: [
      { key: "ignition_wire_colour",   label: "Ignition Wire Colour" },
      { key: "ignition_wire_location", label: "Ignition Wire — Exact Location", type: "textarea", photoCategory: "ignition_wire" },
      { key: "fuse_tap_options",       label: "Fuse Tap Options", type: "textarea" },
      { key: "can_high_colour",        label: "CAN High Colour" },
      { key: "can_low_colour",         label: "CAN Low Colour" },
      { key: "earth_point_location",   label: "Earth Point Location", type: "textarea", photoCategory: "earth_point" },
    ],
  },
  {
    title: "Component Placement",
    color: "purple",
    fields: [
      { key: "airbag_location",           label: "Airbag Location(s)", type: "textarea", photoCategory: "airbag" },
      { key: "adas_camera_position",      label: "ADAS Camera Position", type: "textarea", photoCategory: "adas_camera" },
      { key: "dashcam_mounting_location", label: "Best Dashcam Mounting Location", type: "textarea", photoCategory: "dashcam_mounting" },
      { key: "tracker_mounting_location", label: "Best Tracker Mounting Location", type: "textarea", photoCategory: "tracker_mounting" },
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
  for (const g of FIELD_GROUPS) {
    const f = g.fields.find(x => x.key === key);
    if (f) return f.label;
  }
  return key;
}

export function categoryLabel(key) {
  return PHOTO_CATEGORIES.find(c => c.key === key)?.label || key;
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

export async function getVehicleByRegistration(reg) {
  const { data, error } = await vdb()
    .from("vdb_vehicles")
    .select("*")
    .eq("registration_norm", normalizeReg(reg))
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function searchVehiclesByMakeModelYear({ make, model, year } = {}) {
  let builder = vdb().from("vdb_vehicles").select("*").order("updated_at", { ascending: false });
  if (make) builder = builder.ilike("make", `%${make.trim()}%`);
  if (model) builder = builder.ilike("model", `%${model.trim()}%`);
  if (year) builder = builder.eq("year_of_manufacture", Number(year));
  const { data, error } = await builder.limit(50);
  if (error) throw error;
  return data || [];
}

export async function createVehicle(patch, createdByEmployeeId) {
  const { data, error } = await vdb()
    .from("vdb_vehicles")
    .insert({ ...patch, created_by: createdByEmployeeId, updated_by: createdByEmployeeId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateVehicle(id, patch, updatedByEmployeeId) {
  const { data, error } = await vdb()
    .from("vdb_vehicles")
    .update({ ...patch, updated_by: updatedByEmployeeId })
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

  const { error: upErr } = await sb().storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (upErr) throw upErr;

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

  const { error: upErr } = await sb().storage.from(PHOTO_BUCKET).upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (upErr) throw upErr;

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
 * Approves an edit request: applies the proposed field patch to the vehicle,
 * re-parents any proposed photos from their pending/ storage path to the
 * vehicle's permanent path (so they become visible to every employee, not
 * just the manager/requester), and marks the request approved. Runs entirely
 * under the calling manager's own RLS rights — no elevated RPC needed.
 */
export async function approveEditRequest(request, reviewerEmployeeId, reviewNote = "") {
  if (Object.keys(request.proposed_changes || {}).length) {
    await updateVehicle(request.vehicle_id, request.proposed_changes, reviewerEmployeeId);
  }

  const photos = await listRequestPhotos(request.id);
  for (const photo of photos) {
    const ext = (photo.storage_path.split(".").pop() || "jpg").toLowerCase();
    const newPath = `${request.vehicle_id}/${crypto.randomUUID()}.${ext}`;
    const { error: moveErr } = await sb().storage.from(PHOTO_BUCKET).move(photo.storage_path, newPath);
    if (moveErr) throw moveErr;

    const { error: insErr } = await vdb().from("vdb_vehicle_photos").insert({
      vehicle_id: request.vehicle_id,
      category: photo.category,
      storage_path: newPath,
      caption: photo.caption,
      uploaded_by: request.requested_by,
    });
    if (insErr) throw insErr;
  }

  const { error } = await vdb()
    .from("vdb_edit_requests")
    .update({ status: "approved", reviewed_by: reviewerEmployeeId, review_note: reviewNote || null })
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
