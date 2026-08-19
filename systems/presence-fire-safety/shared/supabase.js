import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://hjdpcfhozhoyeqevnupm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts";

let _client = null;
export function sb() {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    wireWakeRefresh(_client);
  }
  return _client;
}

// supabase-js's default localStorage key for this project — the same key it
// computes internally as `sb-<project-ref>-auth-token`. Kept as an explicit
// constant here because installKioskSession() below writes to it directly,
// bypassing the SDK, so it must match exactly.
const KIOSK_STORAGE_KEY = "sb-hjdpcfhozhoyeqevnupm-auth-token";

function decodeJwtPayload(jwt) {
  const b64 = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return JSON.parse(atob(b64 + pad));
}

/**
 * Installs a kiosk session (a self-signed JWT with no real Supabase Auth
 * user behind it — see functions/api/presence-fire-safety/_kiosk_jwt.js)
 * directly into local storage, in the shape supabase-js expects, instead of
 * calling the SDK's own auth.setSession(). setSession() calls GoTrue's
 * /auth/v1/user endpoint to hydrate the full user object, and GoTrue
 * rejects any JWT whose `sub` isn't a real auth.users row — exactly what a
 * kiosk identity deliberately is not ("User from sub claim in JWT does not
 * exist"). Writing storage directly and then doing a full page navigation
 * avoids that call: the next page's fresh client reads the stored session
 * locally on init and only hits the network if it's near expiry, which a
 * freshly-minted 7-day kiosk token never is.
 */
export function installKioskSession(accessToken, refreshToken) {
  const payload = decodeJwtPayload(accessToken);
  const iat = payload.iat || Math.floor(Date.now() / 1000);
  const nowIso = new Date(iat * 1000).toISOString();
  const session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: payload.exp - iat,
    expires_at: payload.exp,
    user: {
      id: payload.sub,
      aud: payload.aud || "authenticated",
      role: payload.role || "authenticated",
      email: "",
      phone: "",
      app_metadata: {},
      user_metadata: {},
      identities: [],
      created_at: nowIso,
      updated_at: nowIso,
    },
  };
  localStorage.setItem(KIOSK_STORAGE_KEY, JSON.stringify(session));
}

/**
 * Kiosk devices sit on one page for days at a time. If the OS suspends the
 * tab's JS execution (screen-off power saving overnight, backgrounding,
 * etc.), Supabase's own auto-refresh timer can't fire during that
 * suspension — by the time the page "wakes up" the access token can be well
 * past its expiry, and depending how long it's been, the refresh token can
 * have gone stale too. visibilitychange/pageshow/online are all
 * browser/OS-driven rather than JS timers, so they fire reliably even after
 * a full suspension — use them to force an immediate refresh attempt rather
 * than waiting for whatever's left of the normal refresh schedule.
 */
function wireWakeRefresh(client) {
  const tryRefresh = () => { client.auth.refreshSession().catch(() => {}); };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tryRefresh();
  });
  window.addEventListener("pageshow", (e) => { if (e.persisted) tryRefresh(); });
  window.addEventListener("online", tryRefresh);
  // Fallback in case none of the above fire reliably on a given kiosk's browser.
  setInterval(tryRefresh, 15 * 60 * 1000);
}
