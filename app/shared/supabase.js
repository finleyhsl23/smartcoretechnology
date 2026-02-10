// /app/shared/supabase.js
// Hardcoded app config (customers never enter this).
// The anon key is public and safe to ship in frontend.

const SUPABASE_URL = "https://jmgbbybpsnazkxinnpxp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptZ2JieWJwc25hemt4aW5ucHhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTIwNjYwNzcsImV4cCI6MjA2NzY0MjA3N30.2_PG1fun3Q2qNaLqxA7f7s2_VIn6BmRO2wcl5_mKSeo";

let _client = null;

export function supabaseClient() {
  if (_client) return _client;

  if (!window.supabase?.createClient) {
    throw new Error("Supabase JS v2 not loaded.");
  }

  _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  return _client;
}
