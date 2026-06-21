/**
 * /api/core/shift-patterns
 * GET    — list shift patterns for company
 * POST   — create {name, schedule}
 * DELETE — ?id=xxx
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function sbFetch(env, method, path, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text);
}

async function getCaller(request, env) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_KEY },
  });
  if (!res.ok) return null;
  const user = await res.json();
  const profiles = await sbFetch(env, 'GET', `/user_profiles?user_id=eq.${user.id}&select=*&limit=1`);
  return profiles?.[0] || null;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const caller = await getCaller(request, env);
    if (!caller) return json({ error: 'Unauthorised' }, 401);
    const patterns = await sbFetch(env, 'GET',
      `/core_shift_patterns?company_id=eq.${caller.company_id}&select=*&order=name.asc`
    );
    return json({ patterns: patterns || [] });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const caller = await getCaller(request, env);
    if (!caller) return json({ error: 'Unauthorised' }, 401);
    if (!['admin', 'owner'].includes(caller.role)) return json({ error: 'Forbidden' }, 403);

    const body = await request.json();
    const { name, schedule } = body;
    if (!name?.trim()) return json({ error: 'name is required' }, 400);

    const created = await sbFetch(env, 'POST', '/core_shift_patterns', {
      company_id: caller.company_id,
      name: name.trim(),
      schedule: schedule || {},
    });
    return json({ pattern: Array.isArray(created) ? created[0] : created });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const caller = await getCaller(request, env);
    if (!caller) return json({ error: 'Unauthorised' }, 401);
    if (!['admin', 'owner'].includes(caller.role)) return json({ error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'id is required' }, 400);

    await sbFetch(env, 'DELETE',
      `/core_shift_patterns?id=eq.${id}&company_id=eq.${caller.company_id}`
    );
    return json({ success: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
