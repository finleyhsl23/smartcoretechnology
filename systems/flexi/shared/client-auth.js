import { sb } from "./supabase.js";

let _client = null;

export async function requireClientSession() {
  const { data, error } = await sb().auth.getSession();
  if (error || !data?.session) {
    window.location.href = "/systems/flexi/portal/login.html";
    throw new Error("No session");
  }
  return data.session;
}

/**
 * Resolves the caller's smartcore_flexi_clients row. RLS
 * (smartcore_flexi_clients_select_self) scopes this to auth_user_id = auth.uid(),
 * so no company_id filter is needed client-side.
 */
export async function getClientProfile() {
  if (_client) return _client;
  await requireClientSession();

  const { data, error } = await sb()
    .from("smartcore_flexi_clients")
    .select("*, smartcore_flexi_locations(name)")
    .maybeSingle();

  if (error || !data) {
    throw new Error("Client profile not found.");
  }
  _client = data;
  return _client;
}

function wireEscapeButtons() {
  const btn = document.getElementById("clientLogoutBtn");
  if (btn && !btn._wired) {
    btn._wired = true;
    btn.addEventListener("click", async () => {
      await sb().auth.signOut();
      window.location.href = "/systems/flexi/portal/login.html";
    });
  }
}

export async function requireClientAccess() {
  let client;
  try {
    client = await getClientProfile();
  } catch (e) {
    wireEscapeButtons();
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0b0c14;color:#f2f1fa;font-family:system-ui;text-align:center;padding:24px">
        <div>
          <div style="font-size:44px;margin-bottom:14px">⚠️</div>
          <h2 style="font-size:19px;margin-bottom:8px">Account Not Linked</h2>
          <p style="color:rgba(242,241,250,.6);margin-bottom:20px;max-width:380px">We couldn't find a client profile for this account. Ask your trainer to re-send your invite.</p>
          <button id="clientLogoutBtn" style="background:#374151;color:#fff;padding:10px 24px;border-radius:99px;border:none;cursor:pointer;font-weight:600">Sign Out</button>
        </div>
      </div>`;
    wireEscapeButtons();
    throw e;
  }
  wireEscapeButtons();
  return client;
}

export function clearClientCache() {
  _client = null;
}

export async function clientLogout() {
  await sb().auth.signOut();
  window.location.href = "/systems/flexi/portal/login.html";
}
