// Shared auth/authorization helpers for Presence & Fire Safety Cloudflare
// Pages Functions. Mirrors the pattern in functions/api/core/_auth.js —
// fetch-based, no npm dependencies, one shared helper file per module.

export const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
// Same anon (publishable) key already used verbatim elsewhere in this repo,
// e.g. functions/api/crm/seats.js. Safe to ship client-side; RLS + the
// module's SECURITY DEFINER RPCs are the real access boundary.
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export function options() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }});
}

function baseUrl(env) {
  return env.SUPABASE_URL || SUPABASE_URL;
}

export function getToken(request) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return token || null;
}

// Verifies the caller's Supabase session token and resolves their
// core_employees row. Returns null on any auth/lookup failure — callers
// should treat that as 401. The resolved profile carries the caller's own
// bearer `token` forward so downstream RPC calls can be made as that user
// (see rpcAsUser/hasPermission below).
export async function getCallerProfile(request, env) {
  const token = getToken(request);
  if (!token) return null;

  const userRes = await fetch(`${baseUrl(env)}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_KEY },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.id) return null;

  const empRes = await sb(env, `/core_employees?auth_user_id=eq.${user.id}&select=*&limit=1`);
  if (!empRes.ok) return null;
  const profiles = await empRes.json();
  if (!profiles?.length) return null;

  return { ...profiles[0], auth_id: user.id, auth_email: user.email, token };
}

// ---------------------------------------------------------------------------
// Service-role REST helper. Use ONLY for things an ordinary authenticated
// user genuinely cannot do through RLS/RPCs — e.g. writing a device token
// hash, or a bulk read where the caller's permission was already verified
// independently via hasPermission()/an RPC forwarding their own JWT. Never
// use this as a shortcut around a permission check.
// ---------------------------------------------------------------------------
export function sb(env, path, method = 'GET', body = null) {
  return fetch(`${baseUrl(env)}/rest/v1${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function sbGet(env, path) {
  const r = await sb(env, path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function sbPost(env, path, body) {
  const r = await sb(env, path, 'POST', body);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function sbPatch(env, path, body) {
  const r = await sb(env, path, 'PATCH', body);
  if (!r.ok) throw new Error(await r.text());
}

export async function sbDelete(env, path) {
  const r = await sb(env, path, 'DELETE');
  if (!r.ok) throw new Error(await r.text());
}

// ---------------------------------------------------------------------------
// User-scoped (RLS-respecting) helpers. Forward the CALLER'S OWN bearer
// token instead of the service-role key so that `auth.uid()` resolves
// correctly inside SECURITY DEFINER RPCs (presence_fire_safety_has_permission
// etc.) and so plain table reads are naturally scoped by RLS policies. This
// is the correct way to call any permission-sensitive RPC or read report
// data from a server-side Function in this module — substituting the
// service-role key for these would make auth.uid() NULL and the RPC would
// silently always deny.
// ---------------------------------------------------------------------------
export async function rpcAsUser(env, token, fnName, payload = {}) {
  const res = await fetch(`${baseUrl(env)}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = data?.message || data?.error_description || data?.error || text || 'RPC failed';
    const err = new Error(message);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

export async function selectAsUser(env, token, resourcePath) {
  const res = await fetch(`${baseUrl(env)}/rest/v1${resourcePath}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const message = data?.message || data?.error || text || 'Request failed';
    const err = new Error(message);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// True if the caller (identified by their OWN bearer token) holds
// `permission` within `companyId`. This just forwards to the
// presence_fire_safety_has_permission RPC as the calling user — it is a
// server-side re-check, not a UI convenience, so callers should 403 on false.
export async function hasPermission(env, token, companyId, permission) {
  try {
    const result = await rpcAsUser(env, token, 'presence_fire_safety_has_permission', {
      p_company_id: companyId,
      p_permission: permission,
    });
    return result === true;
  } catch {
    return false;
  }
}
