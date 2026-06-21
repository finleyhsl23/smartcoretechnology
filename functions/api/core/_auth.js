// Shared auth helper for core API endpoints
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

export async function getCallerProfile(request, env) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!token) return null;

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_KEY },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();

  const profileRes = await sb(env, `/smartcore_core_employees?user_id=eq.${user.id}&select=*&limit=1`);
  const profiles = await profileRes.json();
  if (!profiles?.length) return null;
  const profile = profiles[0];
  if (profile.is_active === false) return null;
  return { ...profile, auth_id: user.id, auth_email: user.email };
}

export function sb(env, path, method = 'GET', body = null) {
  return fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
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
