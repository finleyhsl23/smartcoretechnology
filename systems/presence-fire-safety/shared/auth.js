import { sb } from "./supabase.js";

const MODULE_KEY = "presence-and-fire-safety";
const SITE_STORAGE_KEY = "smartcore-pfs-site";

let _profile = null;
let _permissions = null;
let _sites = null;

export async function requireAuth() {
  const { data, error } = await sb().auth.getSession();
  if (error || !data?.session) {
    window.location.href = "/modules/";
    throw new Error("No session");
  }
  return data.session;
}

/**
 * Resolves the caller's employee profile from core_employees (the same
 * identity source the CRM module uses). Throws if no profile exists —
 * onboarding_completed / auth_user_id null both surface as "not found".
 */
export async function getProfile() {
  if (_profile) return _profile;
  const session = await requireAuth();
  const uid = session.user.id;

  const { data: rows, error } = await sb()
    .from("core_employees")
    .select("id, company_id, role, full_name, work_email, department_id, auth_user_id")
    .eq("auth_user_id", uid)
    .order("created_at", { ascending: false })
    .limit(1);

  const data = rows?.[0] ?? null;
  if (error || !data) {
    throw new Error("Employee profile not found. Contact your administrator.");
  }

  _profile = { ...data, email: session.user.email };
  return _profile;
}

function wireEscapeButtons() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn && !logoutBtn._wired) {
    logoutBtn._wired = true;
    logoutBtn.addEventListener("click", async () => {
      if (confirm("Sign out of SmartCore?")) {
        await sb().auth.signOut();
        window.location.href = "/modules/";
      }
    });
  }
}

function renderBlockScreen({ icon, title, message, actionHref, actionLabel }) {
  wireEscapeButtons();
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#05081a;color:#e9f0ff;font-family:'Inter',system-ui">
      <div style="text-align:center;max-width:440px;padding:24px">
        <div style="font-size:48px;margin-bottom:16px">${icon}</div>
        <h2 style="font-size:20px;margin-bottom:8px">${title}</h2>
        <p style="color:rgba(233,240,255,.6);margin-bottom:20px">${message}</p>
        <a href="${actionHref || "/modules/"}" style="background:#1e5cff;color:#fff;padding:10px 24px;border-radius:99px;text-decoration:none;font-weight:600;margin-right:8px">${actionLabel || "← Back to Modules"}</a>
        <button id="logoutBtn" style="background:#374151;color:#fff;padding:10px 24px;border-radius:99px;border:none;cursor:pointer;font-weight:600">Sign Out</button>
      </div>
    </div>`;
  wireEscapeButtons();
}

/**
 * Full module access flow (SmartCore Presence & Fire Safety spec §9):
 *  1. Valid session      -> requireAuth() above
 *  2. Employee is active -> auth_user_id resolved (no separate active flag
 *     exists on core_employees today; this is the closest available signal)
 *  3. Company entitlement -> company_modules.enabled for this module_key
 *  4. Site is selected/valid for this company (site access is enforced
 *     server-side on every RPC/RLS policy regardless of what the client sends)
 */
export async function requirePresenceModuleAccess() {
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
      actionHref: "/shop/index.html",
      actionLabel: "View Plans →",
    });
    throw new Error("Presence & Fire Safety not enabled");
  }

  const permissions = await getMyPermissions(profile.company_id);
  if (!permissions.length) {
    renderBlockScreen({
      icon: "🚫",
      title: "No Access",
      message: "You don't have any Presence & Fire Safety permissions yet. Ask an owner or administrator to grant you access.",
    });
    throw new Error("No permissions");
  }

  return { profile, permissions };
}

export async function getMyPermissions(companyId) {
  if (_permissions) return _permissions;
  const { data, error } = await sb().rpc("presence_fire_safety_my_permissions", { p_company_id: companyId });
  if (error) throw error;
  _permissions = data || [];
  return _permissions;
}

export function hasPermission(permission) {
  return (_permissions || []).includes(permission);
}

/** Sites the current company has configured (client convenience list; every
 *  server RPC re-validates site access independently via has_site_access). */
export async function listSites(companyId) {
  if (_sites) return _sites;
  const { data, error } = await sb()
    .from("sites")
    .select("id, name, is_default, is_active, assembly_point")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("name");
  if (error) throw error;
  _sites = data || [];
  return _sites;
}

export function getSelectedSiteId() {
  return localStorage.getItem(SITE_STORAGE_KEY) || null;
}

export function setSelectedSiteId(siteId) {
  localStorage.setItem(SITE_STORAGE_KEY, siteId);
}

/** Ensures a valid site is selected, defaulting to the company's default
 *  site (or the only site) if none has been chosen yet. */
export async function ensureSiteSelected(companyId) {
  const sites = await listSites(companyId);
  if (!sites.length) return null;

  let selected = getSelectedSiteId();
  if (!selected || !sites.some(s => s.id === selected)) {
    selected = (sites.find(s => s.is_default) || sites[0]).id;
    setSelectedSiteId(selected);
  }
  return selected;
}

export async function logout() {
  await sb().auth.signOut();
  window.location.href = "/modules/";
}

export function clearProfileCache() {
  _profile = null;
  _permissions = null;
  _sites = null;
}
