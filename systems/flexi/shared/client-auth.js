// Client-portal auth — session-token based, no Supabase Auth involved at
// all (clients never get an auth.users row). The session token comes back
// from POST /api/flexi/portal-login and is sent as a Bearer token on every
// subsequent call to POST /api/flexi/portal-api.

const SESSION_KEY = "flexi_client_session";
const API_URL = "/api/flexi/portal-api";
const LOGIN_URL = "/systems/flexi/portal/login.html";

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}

export function storeSession(session_token, client) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ session_token, client }));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function getToken() {
  return readSession()?.session_token || null;
}

// Generic call into the multiplexed portal-api action endpoint. Redirects
// to login on a *confirmed* expired/invalid session rather than surfacing a
// raw 401 — but a single network blip or cold-start hiccup on the edge
// function should never be enough to sign someone out, so both a network
// failure and a 401 get one retry before we actually give up and clear the
// session. Only a 401 that survives the retry is treated as a real logout.
export async function api(action, params = {}, _isRetry = false) {
  const token = getToken();
  if (!token) {
    window.location.href = LOGIN_URL;
    throw new Error("No session");
  }
  let res, data;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...params }),
    });
    data = await res.json().catch(() => ({}));
  } catch (networkErr) {
    if (!_isRetry) { await new Promise(r => setTimeout(r, 500)); return api(action, params, true); }
    throw new Error("Network error — please check your connection and try again.");
  }
  if (res.status === 401) {
    if (!_isRetry) { await new Promise(r => setTimeout(r, 500)); return api(action, params, true); }
    clearSession();
    window.location.href = LOGIN_URL;
    throw new Error(data.error || "Session expired");
  }
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function wireEscapeButtons() {
  const btn = document.getElementById("clientLogoutBtn");
  if (btn && !btn._wired) {
    btn._wired = true;
    btn.addEventListener("click", () => {
      if (confirm("Sign out?")) {
        clearSession();
        window.location.href = LOGIN_URL;
      }
    });
  }
}

export async function requireClientAccess() {
  if (!getToken()) {
    window.location.href = LOGIN_URL;
    throw new Error("No session");
  }
  try {
    const { client } = await api("me");
    storeSession(getToken(), client);
    wireEscapeButtons();
    return client;
  } catch (e) {
    wireEscapeButtons();
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0b0c14;color:#f2f1fa;font-family:system-ui;text-align:center;padding:24px">
        <div>
          <div style="font-size:44px;margin-bottom:14px">⚠️</div>
          <h2 style="font-size:19px;margin-bottom:8px">Couldn't load your account</h2>
          <p style="color:rgba(242,241,250,.6);margin-bottom:20px;max-width:380px">${e.message === "No session" ? "Please sign in again." : e.message}</p>
          <a href="${LOGIN_URL}" style="background:#ff5a36;color:#fff;padding:10px 24px;border-radius:99px;text-decoration:none;font-weight:600">Sign In</a>
        </div>
      </div>`;
    throw e;
  }
}

export async function clientLogout() {
  clearSession();
  window.location.href = LOGIN_URL;
}

// Maps a toggleable feature (see TOGGLEABLE_FEATURES in shared/auth.js) to
// the portal page that shows it. Call right after requireClientAccess() —
// hides any nav link/tab pointing at a disabled feature's page, and bounces
// the client to the dashboard if they're on that page directly.
const PORTAL_FEATURE_PAGES = {
  programs: "train.html",
  messages: "chat.html",
  nutrition: "nutrition.html",
  checkins: "checkins.html",
  waivers: "waivers.html",
  community: "community.html",
};

export function applyPortalFeatureGating(disabledFeatures) {
  const disabled = new Set(disabledFeatures || []);
  const currentPage = window.location.pathname.split("/").pop();
  for (const [feature, page] of Object.entries(PORTAL_FEATURE_PAGES)) {
    if (!disabled.has(feature)) continue;
    document.querySelectorAll(`a[href="${page}"]`).forEach(el => { el.style.display = "none"; });
    if (currentPage === page) window.location.href = "dashboard.html";
  }
}
