/**
 * GET /api/core/get-employees
 * Returns all employees for the caller's company with related data.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function sbFetch(env, method, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
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

    const select = [
      '*',
      'department:core_departments(id,name)',
      'shift_pattern:core_shift_patterns(id,name)',
      'authorizers:core_employee_authorizers(authorizer_employee_id,authorizer:core_employees!core_employee_authorizers_authorizer_employee_id_fkey(id,full_name,role))',
    ].join(',');

    const employees = await sbFetch(
      env,
      'GET',
      `/core_employees?company_id=eq.${caller.company_id}&select=${encodeURIComponent(select)}&order=created_at.asc`
    );

    return json({ employees: employees || [] });
  } catch (err) {
    console.error('get-employees error:', err);
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}
