// /app/shared/supabase.js
export function getSupabaseConfig() {
  const url =
    window.SMARTCORE_SUPABASE_URL ||
    localStorage.getItem("SMARTCORE_SUPABASE_URL");

  const anon =
    window.SMARTCORE_SUPABASE_ANON_KEY ||
    localStorage.getItem("SMARTCORE_SUPABASE_ANON_KEY");

  if (!url || !anon) {
    throw new Error(
      "Supabase config missing. Set SMARTCORE_SUPABASE_URL and SMARTCORE_SUPABASE_ANON_KEY."
    );
  }
  return { url, anon };
}

let _client = null;

export function supabaseClient() {
  if (_client) return _client;

  const { url, anon } = getSupabaseConfig();

  if (!window.supabase?.createClient) {
    throw new Error("Supabase JS v2 not loaded.");
  }

  _client = window.supabase.createClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  return _client;
}

