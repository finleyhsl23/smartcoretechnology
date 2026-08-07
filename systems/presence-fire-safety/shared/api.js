import { sb } from "./supabase.js";
import { getProfile, getSelectedSiteId } from "./auth.js";

async function ctx() {
  const profile = await getProfile();
  const siteId = getSelectedSiteId();
  return { profile, companyId: profile.company_id, siteId };
}

function newRequestId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function unwrapRpc({ data, error }) {
  if (error) throw new Error(error.message || "Request failed");
  return data;
}

// ── Sites ────────────────────────────────────────────────────────────────
export const sites = {
  async list(companyId) {
    const { data, error } = await sb().from("sites").select("*").eq("company_id", companyId).order("is_default", { ascending: false }).order("name");
    if (error) throw error;
    return data || [];
  },
  async create(companyId, fields) {
    const { data, error } = await sb().from("sites").insert({ ...fields, company_id: companyId }).select().single();
    if (error) throw error;
    return data;
  },
  async update(id, fields) {
    const { data, error } = await sb().from("sites").update(fields).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },
};

// ── Employee lookup (for manual sign-in / host / badge assignment) ──────
export const employees = {
  async search(companyId, query, { limit = 20 } = {}) {
    let q = sb().from("core_employees")
      .select("id, full_name, job_title, department_id, employee_id, work_email")
      .eq("company_id", companyId)
      .order("full_name")
      .limit(limit);
    if (query) q = q.or(`full_name.ilike.%${query}%,employee_id.ilike.%${query}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async byCode(companyId, employeeCode) {
    const { data, error } = await sb().from("core_employees")
      .select("id, full_name, job_title, department_id, employee_id")
      .eq("company_id", companyId).eq("employee_id", employeeCode).maybeSingle();
    if (error) throw error;
    return data;
  },
  async departments(companyId) {
    const { data, error } = await sb().from("core_departments").select("id, name").eq("company_id", companyId).order("name");
    if (error) throw error;
    return data || [];
  },
  /** Full data needed to render an ID card: photo, name, job title, code. */
  async forIdCard(companyId, employeeId) {
    const { data, error } = await sb().from("core_employees")
      .select("id, full_name, job_title, employee_id, profile_picture_url")
      .eq("company_id", companyId).eq("id", employeeId).maybeSingle();
    if (error) throw error;
    return data;
  },
};

// ── Badges ───────────────────────────────────────────────────────────────
export const badges = {
  async forEmployee(employeeId) {
    const { data, error } = await sb().from("presence_fire_safety_badges").select("*").eq("employee_id", employeeId).eq("status", "active").maybeSingle();
    if (error) throw error;
    return data;
  },
  async byToken(companyId, token) {
    const { data, error } = await sb().from("presence_fire_safety_badges")
      .select("*, core_employees!employee_id(id, full_name, job_title, department_id)")
      .eq("company_id", companyId).eq("badge_token", token).eq("status", "active").maybeSingle();
    if (error) throw error;
    return data;
  },
  async list(companyId) {
    const { data, error } = await sb().from("presence_fire_safety_badges")
      .select("*, core_employees!employee_id(full_name, employee_id)")
      .eq("company_id", companyId).order("issued_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async issue(companyId, employeeId) {
    const { profile } = await ctx();
    const token = `PFS-${crypto.randomUUID ? crypto.randomUUID() : newRequestId()}`;
    const { data, error } = await sb().from("presence_fire_safety_badges")
      .insert({ company_id: companyId, employee_id: employeeId, badge_token: token, issued_by: profile.id })
      .select().single();
    if (error) throw error;
    return data;
  },
  async revoke(badgeId) {
    const { profile } = await ctx();
    const { error } = await sb().from("presence_fire_safety_badges")
      .update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: profile.id })
      .eq("id", badgeId);
    if (error) throw error;
  },
};

// ── Devices ──────────────────────────────────────────────────────────────
export const devices = {
  async list(companyId) {
    const { data, error } = await sb().from("presence_fire_safety_devices").select("*").eq("company_id", companyId).order("device_name");
    if (error) throw error;
    return data || [];
  },
  async deactivate(deviceId) {
    const { error } = await sb().from("presence_fire_safety_devices").update({ active: false }).eq("id", deviceId);
    if (error) throw error;
  },
};

// ── Presence: live register, history, transactional sign in/out ─────────
export const presence = {
  /** Live onsite register for the selected site (or all sites if siteId is null and caller has multi-site access). */
  async liveRegister(companyId, siteId) {
    let q = sb().from("presence_fire_safety_current_presence")
      .select(`
        id, subject_type, current_status, last_seen_at, site_id,
        core_employees(id, full_name, job_title, department_id, core_departments(name)),
        presence_fire_safety_visitor_visits(id, host_employee_id, visit_reason, presence_fire_safety_visitors(first_name, last_name, organisation)),
        presence_fire_safety_contractor_visits(id, host_employee_id, work_purpose, presence_fire_safety_contractors(business_name, contact_name)),
        presence_fire_safety_events!presence_fire_safety_current_presence_last_event_id_fkey(method)
      `)
      .eq("company_id", companyId)
      .eq("current_status", "in")
      .order("last_seen_at", { ascending: false });
    if (siteId) q = q.eq("site_id", siteId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async myHistory(employeeId, { limit = 50 } = {}) {
    const { data, error } = await sb().from("presence_fire_safety_events")
      .select("id, direction, method, occurred_at, site_id, sites(name)")
      .eq("employee_id", employeeId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async myCurrentStatus(employeeId) {
    const { data, error } = await sb().from("presence_fire_safety_current_presence")
      .select("current_status, last_seen_at, site_id")
      .eq("employee_id", employeeId).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Company-wide presence event history (reports.html "Presence History"
   *  report), mirroring the shape of visitors.history / contractors.history.
   *  Unlike myHistory this is not scoped to one employee — used by report
   *  views that need every subject type in a single timeline. Note: the
   *  underlying RLS policy (pfs_events_select) grants this to callers with
   *  presence.view_live_register + site access, or their own events only —
   *  a caller with presence.export_reports but not presence.view_live_register
   *  will only see rows for their own employee_id. */
  async history(companyId, { siteId, from, to, limit = 200 } = {}) {
    let q = sb().from("presence_fire_safety_events")
      .select(`
        id, subject_type, direction, method, occurred_at, site_id,
        sites(name),
        core_employees!employee_id(full_name, employee_id, core_departments(name)),
        presence_fire_safety_visitor_visits(presence_fire_safety_visitors(first_name, last_name, organisation)),
        presence_fire_safety_contractor_visits(presence_fire_safety_contractors(business_name))
      `)
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (siteId) q = q.eq("site_id", siteId);
    if (from) q = q.gte("occurred_at", from);
    if (to) q = q.lte("occurred_at", to);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  /** Most recent presence events for the dashboard activity feed. Reads the
   *  append-only ledger directly (same RLS as liveRegister: view_live_register
   *  + site access, or the caller's own employee events). */
  async recentEvents(companyId, siteId, limit = 10) {
    let q = sb().from("presence_fire_safety_events")
      .select(`
        id, subject_type, direction, method, occurred_at, notes,
        core_employees!employee_id(full_name),
        presence_fire_safety_visitor_visits(presence_fire_safety_visitors(first_name, last_name, organisation)),
        presence_fire_safety_contractor_visits(presence_fire_safety_contractors(business_name, contact_name))
      `)
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (siteId) q = q.eq("site_id", siteId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  /** Records an employee/visitor/contractor presence event through the
   *  transactional RPC. Always pass a stable requestId when retrying a
   *  network failure so the server can safely de-duplicate. */
  async recordEvent({ siteId, subjectType, direction, method, employeeId, visitorVisitId, contractorVisitId, deviceId, notes, requestId }) {
    const { companyId } = await ctx();
    const { data, error } = await sb().rpc("presence_fire_safety_record_presence_event", {
      p_company_id: companyId,
      p_site_id: siteId,
      p_subject_type: subjectType,
      p_direction: direction,
      p_method: method,
      p_employee_id: employeeId || null,
      p_visitor_visit_id: visitorVisitId || null,
      p_contractor_visit_id: contractorVisitId || null,
      p_device_id: deviceId || null,
      p_source_request_id: requestId || newRequestId(),
      p_notes: notes || null,
    });
    if (error) throw new Error(error.message || "Could not record presence event");
    return data;
  },

  async signSelf({ siteId, direction, method = "manual", requestId }) {
    const { profile } = await ctx();
    return presence.recordEvent({ siteId, subjectType: "employee", direction, method, employeeId: profile.id, requestId });
  },

  async signOthersByEmployee({ siteId, employeeId, direction, method = "manual", requestId }) {
    return presence.recordEvent({ siteId, subjectType: "employee", direction, method, employeeId, requestId });
  },
};

// ── Visitors ─────────────────────────────────────────────────────────────
export const visitors = {
  async search(companyId, query, { limit = 20 } = {}) {
    let q = sb().from("presence_fire_safety_visitors").select("*").eq("company_id", companyId).is("deleted_at", null).order("last_name").limit(limit);
    if (query) q = q.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,organisation.ilike.%${query}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async currentVisits(companyId, siteId) {
    let q = sb().from("presence_fire_safety_visitor_visits")
      .select("*, presence_fire_safety_visitors(first_name, last_name, organisation, phone, photo_path), core_employees!host_employee_id(full_name)")
      .eq("company_id", companyId).eq("status", "signed_in").order("signed_in_at", { ascending: false });
    if (siteId) q = q.eq("site_id", siteId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async history(companyId, { siteId, from, to, limit = 200 } = {}) {
    let q = sb().from("presence_fire_safety_visitor_visits")
      .select("*, presence_fire_safety_visitors(first_name, last_name, organisation)")
      .eq("company_id", companyId).order("created_at", { ascending: false }).limit(limit);
    if (siteId) q = q.eq("site_id", siteId);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async createVisit({ siteId, firstName, lastName, organisation, email, phone, vehicleRegistration, hostEmployeeId, visitReason, photoPath, acceptTerms, signInNow = true }) {
    const { companyId } = await ctx();
    const { data, error } = await sb().rpc("presence_fire_safety_create_visitor_visit", {
      p_company_id: companyId, p_site_id: siteId,
      p_first_name: firstName, p_last_name: lastName,
      p_organisation: organisation || null, p_email: email || null, p_phone: phone || null,
      p_vehicle_registration: vehicleRegistration || null, p_host_employee_id: hostEmployeeId || null,
      p_visit_reason: visitReason || null, p_photo_path: photoPath || null,
      p_accept_terms: !!acceptTerms, p_sign_in_now: signInNow,
    });
    if (error) throw new Error(error.message || "Could not sign in visitor");
    return data;
  },

  async signOut(companyId, visitorVisitId) {
    const { data, error } = await sb().rpc("presence_fire_safety_sign_out_visitor", { p_company_id: companyId, p_visitor_visit_id: visitorVisitId });
    if (error) throw new Error(error.message || "Could not sign out visitor");
    return data;
  },

  photoSignedUrl(companyId, path) {
    return sb().storage.from("presence-fire-safety-photos").createSignedUrl(`${companyId}/${path}`, 3600);
  },

  async uploadPhoto(companyId, visitorId, file) {
    // `file` may be a plain Blob (camera capture) rather than a File, which
    // has no `.name` — fall back to an extension inferred from its MIME type.
    const ext = (file.type || "image/jpeg").split("/")[1] || "jpg";
    const name = file.name || `capture.${ext}`;
    const path = `${companyId}/${visitorId}/${Date.now()}-${name}`;
    const { error } = await sb().storage.from("presence-fire-safety-photos").upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
    if (error) throw error;
    return path;
  },

  /** Patches photo_path after upload. The visitor row must exist before a
   *  photo can be stored at `${companyId}/${visitorId}/...` (uploadPhoto needs
   *  visitorId), but createVisit's p_photo_path is only accepted at creation
   *  time — so the flow is createVisit -> uploadPhoto -> setPhoto. Plain table
   *  update under the existing pfs_visitors_write RLS policy (manage_visitors). */
  async setPhoto(visitorId, photoPath) {
    const { data, error } = await sb().from("presence_fire_safety_visitors")
      .update({ photo_path: photoPath }).eq("id", visitorId).select().single();
    if (error) throw error;
    return data;
  },
};

// ── Contractors ──────────────────────────────────────────────────────────
export const contractors = {
  async search(companyId, query, { limit = 20 } = {}) {
    let q = sb().from("presence_fire_safety_contractors").select("*").eq("company_id", companyId).is("deleted_at", null).order("business_name").limit(limit);
    if (query) q = q.ilike("business_name", `%${query}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async currentVisits(companyId, siteId) {
    let q = sb().from("presence_fire_safety_contractor_visits")
      .select("*, presence_fire_safety_contractors(business_name, contact_name, phone), core_employees!host_employee_id(full_name)")
      .eq("company_id", companyId).eq("status", "signed_in").order("signed_in_at", { ascending: false });
    if (siteId) q = q.eq("site_id", siteId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async history(companyId, { siteId, from, to, limit = 200 } = {}) {
    let q = sb().from("presence_fire_safety_contractor_visits")
      .select("*, presence_fire_safety_contractors(business_name, contact_name)")
      .eq("company_id", companyId).order("created_at", { ascending: false }).limit(limit);
    if (siteId) q = q.eq("site_id", siteId);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async createVisit({ siteId, businessName, contactName, phone, email, hostEmployeeId, workPurpose, permitReference, vehicleRegistration, inductionConfirmed, photoPath, signInNow = true }) {
    const { companyId } = await ctx();
    const { data, error } = await sb().rpc("presence_fire_safety_create_contractor_visit", {
      p_company_id: companyId, p_site_id: siteId,
      p_business_name: businessName, p_contact_name: contactName || null, p_phone: phone || null, p_email: email || null,
      p_host_employee_id: hostEmployeeId || null, p_work_purpose: workPurpose || null, p_permit_reference: permitReference || null,
      p_vehicle_registration: vehicleRegistration || null, p_induction_confirmed: !!inductionConfirmed, p_sign_in_now: signInNow,
      p_photo_path: photoPath || null,
    });
    if (error) throw new Error(error.message || "Could not sign in contractor");
    return data;
  },

  async signOut(companyId, contractorVisitId) {
    const { data, error } = await sb().rpc("presence_fire_safety_sign_out_contractor", { p_company_id: companyId, p_contractor_visit_id: contractorVisitId });
    if (error) throw new Error(error.message || "Could not sign out contractor");
    return data;
  },

  async uploadPhoto(companyId, contractorId, file) {
    const ext = (file.type || "image/jpeg").split("/")[1] || "jpg";
    const name = file.name || `capture.${ext}`;
    const path = `${companyId}/${contractorId}/${Date.now()}-${name}`;
    const { error } = await sb().storage.from("presence-fire-safety-photos").upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });
    if (error) throw error;
    return path;
  },

  /** Patches photo_path after upload — same ordering constraint as
   *  visitors.setPhoto (the contractor row must exist first to know its id). */
  async setPhoto(contractorId, photoPath) {
    const { data, error } = await sb().from("presence_fire_safety_contractors")
      .update({ photo_path: photoPath }).eq("id", contractorId).select().single();
    if (error) throw error;
    return data;
  },
};

// ── Settings ─────────────────────────────────────────────────────────────
export const settings = {
  async get(companyId) {
    const { data, error } = await sb().from("presence_fire_safety_settings").select("*").eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async upsert(companyId, fields) {
    const { profile } = await ctx();
    const { data, error } = await sb().from("presence_fire_safety_settings")
      .upsert({ ...fields, company_id: companyId, updated_by: profile.id }, { onConflict: "company_id" })
      .select().single();
    if (error) throw error;
    return data;
  },
  async siteOverride(companyId, siteId) {
    const { data, error } = await sb().from("presence_fire_safety_site_settings").select("*").eq("company_id", companyId).eq("site_id", siteId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async setEvacuationPin(companyId, pin) {
    const { error } = await sb().rpc("presence_fire_safety_set_evacuation_pin", { p_company_id: companyId, p_pin: pin });
    if (error) throw new Error(error.message || "Could not set PIN");
  },

  /** Kiosk exit PIN — deliberately separate from the evacuation PIN (see
   *  shared/kiosk.js). Admin-only to set; verify is callable by any
   *  authenticated employee since the PIN itself is the security boundary. */
  async setKioskExitPin(companyId, pin) {
    const { error } = await sb().rpc("presence_fire_safety_set_kiosk_exit_pin", { p_company_id: companyId, p_pin: pin });
    if (error) throw new Error(error.message || "Could not set PIN");
  },
  async verifyKioskExitPin(companyId, pin) {
    const { error } = await sb().rpc("presence_fire_safety_verify_kiosk_exit_pin", { p_company_id: companyId, p_pin: pin });
    if (error) throw new Error(error.message || "Incorrect PIN");
    return true;
  },

  /** Company logo for the ID card template. Public bucket, one object per
   *  company at a stable path — upsert overwrites on re-upload.
   *  Reads the file into bytes immediately rather than handing the raw
   *  File/Blob to the client's upload() call — Safari can invalidate a
   *  <input type="file">'s selected File once the input's value is reset,
   *  which produced an empty request body ("No content provided") if the
   *  caller cleared the input before this async upload finished. */
  // Goes through a server-side Function (service-role upload) rather than a
  // direct client -> Supabase Storage call — the direct upload kept failing
  // RLS in the field for reasons that couldn't be reproduced even with an
  // identical simulated auth context server-side, so this sidesteps it.
  // Permission is still checked server-side via the caller's own token.
  // Sent as the raw file body (not FormData/multipart) — the Function's
  // request.formData() call was failing with "No initial boundary string"
  // as its very first operation, so multipart is avoided entirely here.
  async uploadIdCardLogo(companyId, file) {
    const { data: { session } } = await sb().auth.getSession();
    if (!session) throw new Error("Not signed in");
    const res = await fetch("/api/presence-fire-safety/upload-logo", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": file.type,
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Upload failed");
    return data.url;
  },
};

// ── Evacuation ───────────────────────────────────────────────────────────
export const evacuation = {
  async activeSession(companyId, siteId) {
    let q = sb().from("presence_fire_safety_evacuation_sessions").select("*").eq("company_id", companyId).eq("status", "active");
    if (siteId) q = q.eq("site_id", siteId);
    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return data;
  },

  async rollCall(sessionId) {
    const { data, error } = await sb().from("presence_fire_safety_evacuation_people")
      .select("*").eq("evacuation_session_id", sessionId).order("display_name_snapshot");
    if (error) throw error;
    return data || [];
  },

  async history(companyId, { limit = 50 } = {}) {
    const { data, error } = await sb().from("presence_fire_safety_evacuation_sessions")
      .select("*, sites(name)").eq("company_id", companyId).order("started_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  },

  async verifyPin(companyId, siteId, pin) {
    const { data, error } = await sb().rpc("presence_fire_safety_verify_evacuation_pin", { p_company_id: companyId, p_site_id: siteId, p_pin: pin });
    if (error) throw new Error(error.message || "Incorrect PIN");
    return data?.[0];
  },

  async start(companyId, siteId, unlockToken, assemblyPoint) {
    const { data, error } = await sb().rpc("presence_fire_safety_start_evacuation", {
      p_company_id: companyId, p_site_id: siteId, p_unlock_token: unlockToken, p_assembly_point: assemblyPoint || null,
    });
    if (error) throw new Error(error.message || "Could not start evacuation");
    return data;
  },

  async updateRollCall(evacuationPersonId, rollCallStatus, notes) {
    const { data, error } = await sb().rpc("presence_fire_safety_update_roll_call", {
      p_evacuation_person_id: evacuationPersonId, p_roll_call_status: rollCallStatus, p_notes: notes || null,
    });
    if (error) throw new Error(error.message || "Could not update roll call");
    return data;
  },

  async complete(sessionId) {
    const { data, error } = await sb().rpc("presence_fire_safety_complete_evacuation", { p_session_id: sessionId });
    if (error) throw new Error(error.message || "Could not complete evacuation");
    return data;
  },
};

// ── Audit ────────────────────────────────────────────────────────────────
export const auditLog = {
  async list(companyId, { limit = 100 } = {}) {
    const { data, error } = await sb().from("presence_fire_safety_audit_logs")
      .select("*, core_employees(full_name)").eq("company_id", companyId).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  },
};
