import { sb, auditDb } from "./supabase.js";

export const SMARTFITS_COMPANY_ID = "34c3dc62-25dc-4159-b159-ae7b24479bee";
const MODULE_KEY = "smartfits-engineer-audit";

let _profile = null;
let _tier = null; // 'owner_admin' | 'manager' | 'engineer'

export async function requireAuth() {
  const { data, error } = await sb().auth.getSession();
  if (error || !data?.session) {
    window.location.href = "/modules/";
    throw new Error("No session");
  }
  return data.session;
}

/**
 * Resolves the caller's employee profile from core_employees — the same
 * identity source the /modules/ directory and Presence & Fire Safety use.
 */
export async function getProfile() {
  if (_profile) return _profile;
  const session = await requireAuth();
  const uid = session.user.id;

  const { data: rows, error } = await sb()
    .from("core_employees")
    .select("id, company_id, role, full_name, job_title, department_id, auth_user_id")
    .eq("auth_user_id", uid)
    .limit(1);

  const data = rows?.[0] ?? null;
  if (error || !data) {
    throw new Error("Employee profile not found. Contact your administrator.");
  }
  _profile = { ...data, email: session.user.email };
  return _profile;
}

function renderBlockScreen({ icon, title, message }) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#05081a;color:#e9f0ff;font-family:'Inter',system-ui">
      <div style="text-align:center;max-width:440px;padding:24px">
        <div style="font-size:48px;margin-bottom:16px">${icon}</div>
        <h2 style="font-size:20px;margin-bottom:8px">${title}</h2>
        <p style="color:rgba(233,240,255,.6);margin-bottom:20px">${message}</p>
        <a href="/modules/" style="background:#1e5cff;color:#fff;padding:10px 24px;border-radius:99px;text-decoration:none;font-weight:600;margin-right:8px">← Back to Modules</a>
        <button id="logoutBtn" style="background:#374151;color:#fff;padding:10px 24px;border-radius:99px;border:none;cursor:pointer;font-weight:600">Sign Out</button>
      </div>
    </div>`;
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await sb().auth.signOut();
    window.location.href = "/modules/";
  });
}

const SETTINGS_ID = "00000000-0000-0000-0000-000000000001";
const SETTINGS_DEFAULTS = { visible_department_ids: [], manager_employee_ids: [], fail_threshold_percent: 60, leaderboard_enabled: true };

/**
 * Full module access flow:
 *  1. Valid session      -> requireAuth()
 *  2. Employee profile exists in core_employees
 *  3. Employee belongs to Smartfits (this module is Smartfits-only)
 *  4. Company entitlement -> company_modules.enabled for this module_key
 * Returns { profile, tier, settings } where tier is 'owner_admin' | 'manager'
 * | 'engineer'. 'manager' (Engineering Manager) is not a stored role — it's
 * derived from having at least one active audit_manager_assignments row as
 * manager, or being on the roster in Settings. `settings` is the module's
 * singleton audit_settings row, fetched once here so every page can reuse it
 * (nav gating, department/threshold filters) without a repeat query.
 */
export async function requireModuleAccess() {
  let profile;
  try {
    profile = await getProfile();
  } catch (e) {
    renderBlockScreen({
      icon: "⚠️",
      title: "Profile Not Found",
      message: "Your employee profile hasn't been set up yet. Contact your administrator.",
    });
    throw e;
  }

  if (profile.company_id !== SMARTFITS_COMPANY_ID) {
    renderBlockScreen({
      icon: "🚫",
      title: "Not Available",
      message: "The Engineer Install Audit module is only available to Smartfits Installations Ltd.",
    });
    throw new Error("Wrong company");
  }

  const { data: mod, error } = await sb()
    .from("company_modules")
    .select("enabled")
    .eq("company_id", profile.company_id)
    .eq("module_key", MODULE_KEY)
    .maybeSingle();

  if (error || !mod?.enabled) {
    renderBlockScreen({
      icon: "🔒",
      title: "Module Not Enabled",
      message: "This module has not been enabled for your company.",
    });
    throw new Error("Module not enabled");
  }

  const { data: settingsRow } = await auditDb()
    .from("audit_settings")
    .select("*")
    .eq("id", SETTINGS_ID)
    .maybeSingle();
  const settings = { ...SETTINGS_DEFAULTS, ...(settingsRow || {}) };

  const tier = await resolveTier(profile, settings);
  _tier = tier;
  return { profile, tier, settings };
}

async function resolveTier(profile, settings) {
  if (profile.role === "owner" || profile.role === "admin") return "owner_admin";

  // Membership in the curated Senior Regional Engineering Manager roster
  // (set on the Settings page) counts as "manager" tier immediately, even
  // before any engineer has actually been assigned to them yet.
  if (settings.manager_employee_ids?.includes(profile.id)) return "manager";

  const { count } = await auditDb()
    .from("audit_manager_assignments")
    .select("id", { count: "exact", head: true })
    .eq("manager_employee_id", profile.id)
    .eq("is_active", true);

  return count > 0 ? "manager" : "engineer";
}

export function getTier() {
  return _tier;
}

export function clearProfileCache() {
  _profile = null;
  _tier = null;
}

export async function logout() {
  await sb().auth.signOut();
  window.location.href = "/modules/";
}
