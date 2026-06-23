import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://hjdpcfhozhoyeqevnupm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts";

let _client = null;
export function sb() {
  if (!_client) _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      // Prevent mobile Safari from caching GET responses
      fetch: (url, opts = {}) => fetch(url, { ...opts, cache: "no-store" }),
    },
  });
  return _client;
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };
