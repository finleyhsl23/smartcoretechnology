/**
 * GET /api/core/verify-onboarding-token?token=xxx
 * No auth — validates an onboarding token and returns employee info.
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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (!token) return json({ error: 'token is required' }, 400);

    const select = encodeURIComponent('*,employee:core_employees(id,full_name,personal_email,work_email,company_id,employee_id,role)');
    const records = await sbFetch(env, `/core_onboarding_tokens?token=eq.${token}&select=${select}&limit=1`);
    const record = records?.[0];

    if (!record) return json({ error: 'Token not found' }, 404);
    if (record.used_at) return json({ error: 'Token has already been used' }, 400);
    if (new Date(record.expires_at) < new Date()) return json({ error: 'Token has expired' }, 400);

    const employee = record.employee;
    if (!employee) return json({ error: 'Employee not found' }, 404);

    const companies = await sbFetch(env, `/companies?id=eq.${employee.company_id}&select=name&limit=1`);
    const companyName = companies?.[0]?.name || 'Your Company';

    return json({
      full_name: employee.full_name,
      personal_email: employee.personal_email,
      work_email: employee.work_email,
      company_name: companyName,
      employee_id: employee.employee_id,
      employee_record_id: employee.id,
      role: employee.role,
    });
  } catch (err) {
    console.error('verify-onboarding-token error:', err);
    return json({ error: err.message }, 500);
  }
}
