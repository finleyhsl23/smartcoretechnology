// Shared helpers for the Hassalls private surveillance ingestion API.
// Anon-key only, same as the client-side Supabase pattern used everywhere
// else in SmartCore — no service-role key. Authorization for writes comes
// from the caller's `x-ingestion-key` header, which Postgres RLS resolves
// via hassalls.current_ingestion_site_id() (see supabase/migrations/
// 20260811090000_hassalls_foundation.sql). hassalls is a non-public schema,
// so every REST/RPC call must carry the PostgREST `Content-Profile` header
// to reach it.

export const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-ingestion-key',
  'Content-Type': 'application/json',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export function options() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-ingestion-key',
    },
  });
}

function anonKey(env) {
  return env.SUPABASE_ANON || SUPABASE_ANON_KEY;
}

function baseUrl(env) {
  return (env.SUPABASE_URL || SUPABASE_URL).replace(/\/$/, '');
}

// Table read/write against the hassalls schema, anon key + forwarded
// ingestion key. `Prefer: return=minimal` throughout — anon has no SELECT
// grant on any hassalls table (RLS would hide the rows anyway, but there's
// no reason to ask PostgREST to try), so the caller must already know any
// ids it needs (generated client-side with crypto.randomUUID()).
export async function hassallsRest(env, path, ingestionKey, method, body) {
  const res = await fetch(`${baseUrl(env)}/rest/v1${path}`, {
    method,
    headers: {
      apikey: anonKey(env),
      Authorization: `Bearer ${anonKey(env)}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'hassalls',
      'x-ingestion-key': ingestionKey,
      Prefer: 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res;
}

export async function hassallsRpc(env, fn, ingestionKey, args) {
  return hassallsRest(env, `/rpc/${fn}`, ingestionKey, 'POST', args);
}
