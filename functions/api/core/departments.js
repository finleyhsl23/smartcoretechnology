/**
 * /api/core/departments
 * GET   — list departments with employee count
 * POST  — create department {name} OR reassign ?action=reassign {from_department_id, to_department_id}
 * DELETE — delete department ?id=xxx
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

async function sbFetch(env, method, path, body, extraHeaders = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...extraHeaders,
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

    const departments = await sbFetch(env, 'GET',
      `/core_departments?company_id=eq.${caller.company_id}&select=*,employee_count:core_employees(count)&order=name.asc`
    );

    return json({ departments: departments || [] });
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

    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const body = await request.json();

    if (action === 'reassign') {
      const { from_department_id, to_department_id } = body;
      if (!from_department_id) return json({ error: 'from_department_id required' }, 400);
      await sbFetch(env, 'PATCH',
        `/core_employees?company_id=eq.${caller.company_id}&department_id=eq.${from_department_id}`,
        { department_id: to_department_id || null }
      );
      return json({ success: true });
    }

    // Create department
    const { name } = body;
    if (!name?.trim()) return json({ error: 'name is required' }, 400);

    const created = await sbFetch(env, 'POST', '/core_departments', {
      company_id: caller.company_id,
      name: name.trim(),
    });
    return json({ department: Array.isArray(created) ? created[0] : created });
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
      `/core_departments?id=eq.${id}&company_id=eq.${caller.company_id}`
    );
    return json({ success: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
