import { sb } from "./supabase.js";

const MODULE_KEY = "flexi";
const ADMIN_ROLES = ["owner", "admin", "administrator"];

let _profile = null;
let _permissions = null;
let _tier = "starter";
let _disabledFeatures = [];
let _backgroundTracks = [];

export function isAdmin(profile) {
  return ADMIN_ROLES.includes(profile?.role);
}

export async function requireAuth() {
  let { data, error } = await sb().auth.getSession();
  if (error || !data?.session) {
    // getSession() can occasionally resolve before the client has finished
    // restoring a persisted session from storage right after a cold page
    // load (every Flexi page is a full reload, not an SPA route change) —
    // give it one more beat before treating this as a real logout.
    await new Promise(resolve => setTimeout(resolve, 400));
    ({ data, error } = await sb().auth.getSession());
  }
  if (error || !data?.session) {
    window.location.href = "/modules/";
    throw new Error("No session");
  }
  return data.session;
}

export async function getProfile() {
  if (_profile) return _profile;
  const session = await requireAuth();
  const uid = session.user.id;

  const { data: rows, error } = await sb()
    .from("core_employees")
    .select("id, company_id, role, full_name, work_email, auth_user_id")
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

export function wireEscapeButtons() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn && !logoutBtn._wired) {
    logoutBtn._wired = true;
    logoutBtn.addEventListener("click", async () => {
      if (confirm("Sign out of Flexi?")) {
        await sb().auth.signOut();
        window.location.href = "/modules/";
      }
    });
  }
}

function renderBlockScreen({ icon, title, message, actionHref, actionLabel }) {
  wireEscapeButtons();
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0b0c14;color:#f2f1fa;font-family:system-ui">
      <div style="text-align:center;max-width:440px;padding:24px">
        <div style="font-size:48px;margin-bottom:16px">${icon}</div>
        <h2 style="font-size:20px;margin-bottom:8px">${title}</h2>
        <p style="color:rgba(242,241,250,.6);margin-bottom:20px">${message}</p>
        <a href="${actionHref || "/modules/"}" style="background:#ff5a36;color:#fff;padding:10px 24px;border-radius:99px;text-decoration:none;font-weight:600;margin-right:8px">${actionLabel || "← Back to Modules"}</a>
        <button id="logoutBtn" style="background:#374151;color:#fff;padding:10px 24px;border-radius:99px;border:none;cursor:pointer;font-weight:600">Sign Out</button>
      </div>
    </div>`;
  wireEscapeButtons();
}

// Tier feature gates — mirrors SmartCore CRM's tierHasFeature pattern.
export const TIER_FEATURES = {
  starter: [
    "dashboard", "clients", "client_detail", "programs", "exercises",
    "bookings", "messages", "progress", "waivers", "settings",
  ],
  pro: [
    "dashboard", "clients", "client_detail", "programs", "exercises",
    "bookings", "messages", "progress", "waivers", "settings",
    "nutrition", "habits", "checkins", "packages", "reports",
  ],
  business: [
    "dashboard", "clients", "client_detail", "programs", "exercises",
    "bookings", "messages", "progress", "waivers", "settings",
    "nutrition", "habits", "checkins", "packages", "reports",
    "classes", "team", "community",
  ],
  enterprise: [
    "dashboard", "clients", "client_detail", "programs", "exercises",
    "bookings", "messages", "progress", "waivers", "settings",
    "nutrition", "habits", "checkins", "packages", "reports",
    "classes", "team", "community",
    "locations", "audit_log",
  ],
};

export function tierHasFeature(tier, feature) {
  return (TIER_FEATURES[tier] || TIER_FEATURES.starter).includes(feature);
}

export function currentTier() {
  return _tier;
}

// Features a trainer can switch off per-company in Settings — hidden from
// both the trainer nav/pages and the client portal once disabled. Separate
// from tier gating: a feature can be on the plan but still toggled off.
export const TOGGLEABLE_FEATURES = [
  "programs", "classes", "nutrition", "checkins",
  "waivers", "community", "packages", "messages",
];

export function disabledFeatures() {
  return _disabledFeatures;
}

export function backgroundTracks() {
  return _backgroundTracks;
}

// Combines the tier gate with the company's own on/off toggle — nav.js and
// requireFlexiAccess() both defer to this rather than checking tier alone.
export function isFeatureEnabled(tier, feature) {
  return tierHasFeature(tier, feature) && !_disabledFeatures.includes(feature);
}

/**
 * Full module access flow: session -> employee profile -> company
 * entitlement (company_modules.flexi) -> at least one Flexi permission.
 * Pass { feature: 'classes' } to also gate on the company's purchased tier.
 */
export async function requireFlexiAccess({ feature } = {}) {
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
    .select("enabled, tier")
    .eq("company_id", profile.company_id)
    .eq("module_key", MODULE_KEY)
    .maybeSingle();

  if (error || !mod?.enabled) {
    renderBlockScreen({
      icon: "🔒",
      title: "Flexi Not Enabled",
      message: "Your company hasn't purchased Flexi yet.",
      actionHref: "/shop/index.html",
      actionLabel: "View Plans →",
    });
    throw new Error("Flexi not enabled");
  }
  _tier = mod.tier || "starter";

  const { data: settingsRow } = await sb()
    .from("smartcore_flexi_settings")
    .select("disabled_features, background_tracks")
    .eq("company_id", profile.company_id)
    .maybeSingle();
  _disabledFeatures = settingsRow?.disabled_features || [];
  _backgroundTracks = settingsRow?.background_tracks || [];

  const permissions = await getMyPermissions(profile.company_id);
  if (!permissions.length) {
    renderBlockScreen({
      icon: "🚫",
      title: "No Access",
      message: "You don't have any Flexi permissions yet. Ask an owner or administrator to grant you access.",
    });
    throw new Error("No permissions");
  }

  if (feature && !tierHasFeature(_tier, feature)) {
    renderBlockScreen({
      icon: "⭐",
      title: "Upgrade Required",
      message: `This feature isn't included on your current Flexi plan (${_tier}). Upgrade to unlock it.`,
      actionHref: "/shop/manage-plan.html",
      actionLabel: "Upgrade Plan →",
    });
    throw new Error("Feature not on tier");
  }

  if (feature && _disabledFeatures.includes(feature)) {
    renderBlockScreen({
      icon: "🚫",
      title: "Feature Turned Off",
      message: "This feature has been turned off for your business. An owner or admin can turn it back on in Settings.",
      actionHref: "settings.html",
      actionLabel: "Go to Settings →",
    });
    throw new Error("Feature disabled by company");
  }

  wireEscapeButtons();
  return { profile, permissions, tier: _tier, admin: isAdmin(profile) };
}

export async function getMyPermissions(companyId) {
  if (_permissions) return _permissions;
  const { data, error } = await sb().rpc("flexi_my_permissions", { p_company_id: companyId });
  if (error) throw error;
  _permissions = data || [];
  return _permissions;
}

export function hasPermission(permission) {
  return (_permissions || []).includes(permission);
}

export async function logout() {
  await sb().auth.signOut();
  window.location.href = "/modules/";
}

export function clearProfileCache() {
  _profile = null;
  _permissions = null;
}
