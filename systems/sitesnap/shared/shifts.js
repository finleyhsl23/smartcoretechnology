// Geofenced clock-in/out attendance. All mutations go through SECURITY
// DEFINER RPCs on the server, which re-validate the radius against the
// reported coordinates — this module never trusts a client-side distance
// check as the actual gate, only uses it for immediate UI feedback.
import { sb } from "./supabase.js";

function throwIfError(error) { if (error) throw error; }

const EARTH_RADIUS_MILES = 3958.8;

export function distanceMiles(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.asin(Math.sqrt(a));
}

export const shifts = {
  async getActive(companyId) {
    const { data, error } = await sb().rpc("sitesnap_current_active_shift", { p_company_id: companyId });
    throwIfError(error);
    return data && data.id ? data : null;
  },

  async clockIn(projectId, lat, lng) {
    const { data, error } = await sb().rpc("sitesnap_clock_in", { p_project_id: projectId, p_lat: lat, p_lng: lng });
    throwIfError(error);
    return data;
  },

  async clockOut(shiftId, lat, lng) {
    const { data, error } = await sb().rpc("sitesnap_clock_out", { p_shift_id: shiftId, p_lat: lat, p_lng: lng });
    throwIfError(error);
    return data;
  },

  async ping(shiftId, lat, lng) {
    const { data, error } = await sb().rpc("sitesnap_shift_ping", { p_shift_id: shiftId, p_lat: lat, p_lng: lng });
    throwIfError(error);
    return data;
  },

  // Admins get every shift in the company (RLS); everyone else only ever
  // gets their own regardless of employeeId. Passing employeeId explicitly
  // (rather than relying on that RLS scoping) is what lets an admin also
  // view just their own hours on My Hours, not everyone's.
  async listForCompany(companyId, { from = null, to = null, employeeId = null } = {}) {
    let q = sb().from("sitesnap_shifts")
      .select("*, core_employees(full_name), sitesnap_projects(name)")
      .eq("company_id", companyId).order("clock_in_at", { ascending: false });
    if (from) q = q.gte("clock_in_at", from);
    if (to) q = q.lte("clock_in_at", to);
    if (employeeId) q = q.eq("employee_id", employeeId);
    const { data, error } = await q;
    throwIfError(error);
    return data || [];
  },

  // Admin only — every currently active shift, for the live Map.
  async listActiveForCompany(companyId) {
    const { data, error } = await sb().from("sitesnap_shifts")
      .select("*, core_employees(full_name), sitesnap_projects(name)")
      .eq("company_id", companyId).eq("status", "active").order("clock_in_at", { ascending: false });
    throwIfError(error);
    return data || [];
  },
};
