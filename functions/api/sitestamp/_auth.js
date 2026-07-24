// Shared auth/authorization helpers for SiteStamp Cloudflare Pages Functions.
// Mirrors functions/api/presence-fire-safety/_auth.js — fetch-based, no npm
// dependencies, one shared helper file per module.

export const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
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

// Service-role REST helper. Use only where RLS genuinely cannot do the job
// (hashing/looking up an API key by its hash, or a check already gated by an
// independent hasPermission() call) — never as a shortcut around a check.
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

// True if the caller (identified by their OWN bearer token) holds
// `permission` within `companyId` — forwards to sitestamp_has_permission as
// the calling user, a server-side re-check rather than a UI convenience.
export async function hasPermission(env, token, companyId, permission) {
  try {
    const res = await fetch(`${baseUrl(env)}/rest/v1/rpc/sitestamp_has_permission`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_id: companyId, p_permission: permission }),
    });
    if (!res.ok) return false;
    return (await res.json()) === true;
  } catch {
    return false;
  }
}

// SHA-256 hash of a string, hex-encoded — used to store/verify API keys
// without ever persisting the raw key.
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
