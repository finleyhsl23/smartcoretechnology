/**
 * POST /api/core/add-employee
 * Admin/owner only — creates a new core employee record.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

function randomDigits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const caller = await getCaller(request, env);
    if (!caller) return json({ error: 'Unauthorised' }, 401);
    if (!['admin', 'owner'].includes(caller.role)) return json({ error: 'Forbidden' }, 403);

    const body = await request.json();
    const {
      full_name, job_title, department_id, work_email, personal_email,
      personal_phone, country_code = '+44', employment_type = 'full_time',
      employment_type_custom, notice_period, role = 'employee',
      annual_leave_allowance = 28, executive_allowance_override,
      start_date, authorizer_ids = [], shift_pattern_id,
    } = body;

    if (!full_name) return json({ error: 'full_name is required' }, 400);

    // Get company name for prefix
    const companies = await sbFetch(env, 'GET', `/companies?id=eq.${caller.company_id}&select=name&limit=1`);
    const companyName = companies?.[0]?.name || 'EMP';
    const prefix = companyName.replace(/[^A-Za-z]/g, '').substring(0, 3).toUpperCase() || 'EMP';

    // Generate unique employee_id
    let employee_id = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `${prefix}${randomDigits(9)}`;
      const existing = await sbFetch(env, 'GET', `/core_employees?employee_id=eq.${candidate}&select=id&limit=1`);
      if (!existing?.length) { employee_id = candidate; break; }
    }
    if (!employee_id) return json({ error: 'Could not generate unique employee ID' }, 500);

    const payload = {
      company_id: caller.company_id,
      employee_id,
      full_name,
      job_title: job_title || null,
      department_id: department_id || null,
      work_email: work_email || null,
      personal_email: personal_email || null,
      personal_phone: personal_phone || null,
      country_code,
      employment_type,
      employment_type_custom: employment_type === 'other' ? (employment_type_custom || null) : null,
      notice_period: notice_period || null,
      role,
      annual_leave_allowance: Number(annual_leave_allowance) || 28,
      executive_allowance_override: executive_allowance_override != null ? Number(executive_allowance_override) : null,
      start_date: start_date || null,
      shift_pattern_id: shift_pattern_id || null,
    };

    const created = await sbFetch(env, 'POST', '/core_employees', payload);
    const employee = Array.isArray(created) ? created[0] : created;

    // Insert authorizers
    if (authorizer_ids.length && employee?.id) {
      const authRows = authorizer_ids.map(aid => ({
        employee_id: employee.id,
        authorizer_employee_id: aid,
      }));
      await sbFetch(env, 'POST', '/core_employee_authorizers', authRows);
    }

    return json({ employee });
  } catch (err) {
    console.error('add-employee error:', err);
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}
