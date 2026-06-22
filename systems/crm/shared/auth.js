import { sb } from "./supabase.js";

let _profile = null;

export async function requireAuth() {
  const { data, error } = await sb().auth.getSession();
  if (error || !data?.session) {
    window.location.href = "/modules";
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

export async function requireCRMAccess() {
  const profile = await getProfile();

  const { data: mod, error } = await sb()
    .from("company_modules")
    .select("enabled, tier")
    .eq("company_id", profile.company_id)
    .eq("module_key", "smartcore-crm")
    .maybeSingle();

  if (error || !mod?.enabled) {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#05081a;color:#e9f0ff;font-family:system-ui">
        <div style="text-align:center">
          <div style="font-size:48px;margin-bottom:16px">🔒</div>
          <h2 style="font-size:20px;margin-bottom:8px">SmartCore CRM Not Enabled</h2>
          <p style="color:rgba(233,240,255,.6);margin-bottom:20px">Your company has not purchased SmartCore CRM.</p>
          <a href="/shop/index.html" style="background:#1e5cff;color:#fff;padding:10px 24px;border-radius:99px;text-decoration:none;font-weight:600">View Plans →</a>
        </div>
      </div>`;
    throw new Error("CRM not enabled");
  }

  return { profile, tier: mod.tier || "lite" };
}

export async function getCRMSettings() {
  const { profile } = await requireCRMAccess();

  const { data } = await sb()
    .from("crm_settings")
    .select("*")
    .eq("tenant_id", profile.company_id)
    .maybeSingle();

  return data;
}

export async function logout() {
  await sb().auth.signOut();
  window.location.href = "/app/index.html";
}

export function clearProfileCache() {
  _profile = null;
}

// Tier feature gates
export const TIER_FEATURES = {
  lite:         ["dashboard","companies","contacts","leads","pipeline","tasks","timeline"],
  professional: ["dashboard","companies","contacts","leads","pipeline","tasks","timeline","quotes","documents","calendar","reports","email_templates","lead_scoring","forecasting","custom_fields","esignatures"],
  business:     ["dashboard","companies","contacts","leads","pipeline","tasks","timeline","quotes","documents","calendar","reports","email_templates","lead_scoring","forecasting","custom_fields","esignatures","portal","messaging","projects","multi_site","contracts","renewals","assets","workflows","advanced_permissions","support_tickets"],
  enterprise:   ["dashboard","companies","contacts","leads","pipeline","tasks","timeline","quotes","documents","calendar","reports","email_templates","lead_scoring","forecasting","custom_fields","esignatures","portal","messaging","projects","multi_site","contracts","renewals","assets","workflows","advanced_permissions","support_tickets","executive_dashboards","advanced_analytics","department_mgmt","branch_mgmt","api_access","audit_logs","custom_branding","custom_pipelines","data_import","priority_support"]
};

export function tierHasFeature(tier, feature) {
  return (TIER_FEATURES[tier] || TIER_FEATURES.lite).includes(feature);
}
