// Shared auth/authorization helpers for Convoy Cloudflare Pages Functions.
// Mirrors functions/api/sitesnap/_auth.js — fetch-based, no npm
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

// Service-role REST helper. Use only where RLS genuinely cannot do the job.
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

export function cronAuth(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('x-cron-token');
  return !env.CRON_SECRET || token === env.CRON_SECRET;
}
