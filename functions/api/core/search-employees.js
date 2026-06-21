/**
 * GET /api/core/search-employees?q=name&role_filter=admin,owner
 * Returns matching employees for the caller's company.
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

async function sbFetch(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
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
  const profiles = await sbFetch(env, `/user_profiles?user_id=eq.${user.id}&select=*&limit=1`);
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

    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';
    const role_filter = url.searchParams.get('role_filter') || '';

    let filters = `company_id=eq.${caller.company_id}`;
    if (q.trim()) filters += `&full_name=ilike.*${encodeURIComponent(q.trim())}*`;
    if (role_filter) {
      const roles = role_filter.split(',').map(r => r.trim()).filter(Boolean);
      if (roles.length) filters += `&role=in.(${roles.join(',')})`;
    }

    const employees = await sbFetch(env,
      `/core_employees?${filters}&select=id,full_name,job_title,role,employee_id&limit=10&order=full_name.asc`
    );

    return json({ employees: employees || [] });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
