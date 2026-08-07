// Shared auth helper for Smartfits Vehicle Database Cloudflare Pages
// Functions. Mirrors functions/api/convoy/_auth.js — fetch-based, no npm
// dependencies, one shared helper file per module.

export const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
export const SMARTFITS_COMPANY_ID = '34c3dc62-25dc-4159-b159-ae7b24479bee';

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// Confirms the caller holds a valid Supabase session AND is an active
// core_employees member of Smartfits Installations Ltd specifically — this
// endpoint is Smartfits-only, same restriction the client-side module gate
// enforces via company_modules.
export async function getCallerProfile(request, env) {
  const token = getToken(request);
  if (!token) return null;

  const userRes = await fetch(`${baseUrl(env)}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_KEY },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.id) return null;

  const empRes = await sb(env, `/core_employees?auth_user_id=eq.${user.id}&company_id=eq.${SMARTFITS_COMPANY_ID}&select=*&limit=1`);
  if (!empRes.ok) return null;
  const profiles = await empRes.json();
  if (!profiles?.length) return null;

  return { ...profiles[0], auth_id: user.id, auth_email: user.email };
}

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
