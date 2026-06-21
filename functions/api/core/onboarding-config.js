/**
 * /api/core/onboarding-config
 * GET  — return onboarding config for company
 * POST — update required_fields (admin/owner only)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const DEFAULT_CONFIG = {
  title: false,
  preferred_name: false,
  pronouns: false,
  date_of_birth: true,
  gender: false,
  personal_email: true,
  personal_phone: true,
  address: true,
  emergency_contact_1: true,
  emergency_contact_2: false,
  national_insurance: true,
  bank_details: true,
  student_loan: false,
  tax_code: false,
  dietary_requirements: false,
  accessibility_needs: false,
};

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

    const configs = await sbFetch(env, 'GET',
      `/core_onboarding_config?company_id=eq.${caller.company_id}&select=*&limit=1`
    );
    const config = configs?.[0];
    return json({ required_fields: config?.required_fields || DEFAULT_CONFIG });
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

    const { required_fields } = await request.json();
    if (!required_fields || typeof required_fields !== 'object') {
      return json({ error: 'required_fields must be an object' }, 400);
    }

    const upserted = await sbFetch(env, 'POST', '/core_onboarding_config',
      { company_id: caller.company_id, required_fields, updated_at: new Date().toISOString() },
      { Prefer: 'resolution=merge-duplicates,return=representation' }
    );

    return json({ required_fields: (Array.isArray(upserted) ? upserted[0] : upserted)?.required_fields });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
