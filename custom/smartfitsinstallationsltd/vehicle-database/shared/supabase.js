import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://hjdpcfhozhoyeqevnupm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts";

let _client = null;
export function sb() {
  if (!_client) _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

// Per-query schema proxy for this module's own tables (vdb_vehicles,
// vdb_vehicle_photos, vdb_edit_requests, vdb_edit_request_photos,
// vdb_settings) — all live in the smartfitsinstallationsltd schema.
// Identity/company lookups (core_employees, smartcore_core_companies) stay
// on the default public-schema client returned by sb().
export function vdb() {
  return sb().schema("smartfitsinstallationsltd");
}
