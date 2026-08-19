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
