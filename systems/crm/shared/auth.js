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

function wireEscapeButtons() {
  // Always wire logout + theme so user can exit even when access checks fail
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn && !logoutBtn._wired) {
    logoutBtn._wired = true;
    logoutBtn.addEventListener("click", async () => {
      if (confirm("Sign out of SmartCore CRM?")) {
        await sb().auth.signOut();
        window.location.href = "/modules/";
      }
    });
  }
  const themeBtn = document.getElementById("themeToggle");
  if (themeBtn && !themeBtn._wired) {
    themeBtn._wired = true;
    themeBtn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      themeBtn.textContent = next === "dark" ? "☀️" : "🌙";
      localStorage.setItem("smartcore-crm-theme", next);
    });
  }
}

export async function requireCRMAccess() {
  let profile;
  try {
    profile = await getProfile();
  } catch (e) {
    wireEscapeButtons();
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#05081a;color:#e9f0ff;font-family:system-ui">
        <div style="text-align:center">
          <div style="font-size:48px;margin-bottom:16px">⚠️</div>
          <h2 style="font-size:20px;margin-bottom:8px">Profile Not Found</h2>
          <p style="color:rgba(233,240,255,.6);margin-bottom:20px">Your employee profile hasn't been set up yet. Contact your administrator.</p>
          <a href="/modules/" style="background:#1e3a8a;color:#fff;padding:10px 24px;border-radius:99px;text-decoration:none;font-weight:600;margin-right:8px">← Back to Modules</a>
          <button onclick="(async()=>{await (await import('/systems/crm/shared/supabase.js')).sb().auth.signOut();window.location.href='/modules/';})()" style="background:#374151;color:#fff;padding:10px 24px;border-radius:99px;border:none;cursor:pointer;font-weight:600">Sign Out</button>
        </div>
      </div>`;
    throw e;
  }

  const { data: mod, error } = await sb()
    .from("company_modules")
    .select("enabled, tier")
    .eq("company_id", profile.company_id)
    .eq("module_key", "smartcore-crm")
    .maybeSingle();

  if (error || !mod?.enabled) {
    wireEscapeButtons();
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

  const resolvedTier = mod.tier || "lite";

  // Seat check — owners always have access; everyone else must have a seat
  if (profile.role !== "owner") {
    const session = await sb().auth.getSession();
    const token = session?.data?.session?.access_token;
    if (token) {
      try {
        const seatRes = await fetch("/api/crm/seats", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "check", employee_id: profile.id }),
        });
        const seatData = await seatRes.json();
        if (!seatData.has_seat) {
          wireEscapeButtons();
          document.body.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#05081a;color:#e9f0ff;font-family:system-ui">
              <div style="text-align:center;max-width:420px;padding:24px">
                <div style="font-size:48px;margin-bottom:16px">🪑</div>
                <h2 style="font-size:20px;margin-bottom:8px">No CRM Seat Assigned</h2>
                <p style="color:rgba(233,240,255,.6);margin-bottom:20px">You haven't been given access to SmartCore CRM yet. Ask your admin or owner to assign you a seat.</p>
                <a href="/modules/" style="background:#1e3a8a;color:#fff;padding:10px 24px;border-radius:99px;text-decoration:none;font-weight:600;margin-right:8px">← Back to Modules</a>
                <button onclick="(async()=>{await (await import('/systems/crm/shared/supabase.js')).sb().auth.signOut();window.location.href='/modules/';})()" style="background:#374151;color:#fff;padding:10px 24px;border-radius:99px;border:none;cursor:pointer;font-weight:600">Sign Out</button>
              </div>
            </div>`;
          throw new Error("No CRM seat");
        }
      } catch (e) {
        if (e.message === "No CRM seat") throw e;
        // Network error — fail open so seat check doesn't lock out on transient errors
      }
    }
  }

  return { profile, tier: resolvedTier };
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
  window.location.href = "https://www.smartcoretechnology.co.uk";
}

export function clearProfileCache() {
  _profile = null;
}

// Tier feature gates — only includes features that are actually built
export const TIER_FEATURES = {
  lite: [
    "dashboard","global_search",
    "companies","company_detail","contacts",
    "leads","pipeline","tasks",
    "reminders","commands","department_mgmt",
  ],
  professional: [
    "dashboard","global_search",
    "companies","company_detail","contacts",
    "leads","lead_scoring","pipeline","tasks",
    "calendar","quotes","quote_acceptance",
    "documents","reports","forecasting",
    "email_templates","leaderboard","support_tickets","newsletter",
    "products",
    "reminders","commands","department_mgmt",
  ],
  business: [
    "dashboard","global_search",
    "companies","company_detail","company_team_notes","bulk_actions","contacts",
    "leads","lead_scoring","pipeline","tasks",
    "calendar","quotes","quote_acceptance",
    "documents","reports","forecasting",
    "email_templates","leaderboard","support_tickets","newsletter",
    "messaging","portal","projects",
    "products",
    "custom_pipelines","department_mgmt",
    "reminders","commands",
  ],
  enterprise: [
    "dashboard","global_search",
    "companies","company_detail","company_team_notes","bulk_actions","contacts",
    "leads","lead_scoring","pipeline","tasks",
    "calendar","quotes","quote_acceptance",
    "documents","reports","forecasting",
    "email_templates","leaderboard","support_tickets","newsletter",
    "messaging","portal","projects",
    "products",
    "custom_pipelines","department_mgmt",
    "reminders","commands",
    "ai_support","priority_support","audit_logs",
  ],
};

export function tierHasFeature(tier, feature) {
  return (TIER_FEATURES[tier] || TIER_FEATURES.lite).includes(feature);
}
