/**
 * POST /api/core/complete-onboarding
 * No auth required — completes employee onboarding via token.
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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { token, password, ...fields } = body;

    if (!token) return json({ error: 'token is required' }, 400);
    if (!password || password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);

    // Verify token
    const select = encodeURIComponent('*,employee:core_employees(id,full_name,personal_email,work_email,company_id,employee_id,role)');
    const records = await sbFetch(env, 'GET', `/core_onboarding_tokens?token=eq.${token}&select=${select}&limit=1`);
    const record = records?.[0];

    if (!record) return json({ error: 'Token not found' }, 404);
    if (record.used_at) return json({ error: 'Token has already been used' }, 400);
    if (new Date(record.expires_at) < new Date()) return json({ error: 'Token has expired' }, 400);

    const employee = record.employee;
    if (!employee) return json({ error: 'Employee record not found' }, 404);

    const loginEmail = employee.work_email || fields.personal_email || record.email;

    // Create Supabase auth user
    const authRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: loginEmail,
        password,
        email_confirm: true,
      }),
    });

    if (!authRes.ok) {
      const errText = await authRes.text();
      console.error('Auth user creation error:', errText);
      return json({ error: 'Failed to create user account: ' + errText }, 500);
    }
    const authUser = await authRes.json();

    // Update core_employees with all onboarding data
    const updatePayload = {
      auth_user_id: authUser.id,
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
      title: fields.title || null,
      preferred_name: fields.preferred_name || null,
      pronouns: fields.pronouns || null,
      date_of_birth: fields.date_of_birth || null,
      gender: fields.gender || null,
      personal_email: fields.personal_email || null,
      personal_phone: fields.personal_phone || null,
      country_code: fields.country_code || '+44',
      address_line_1: fields.address_line_1 || null,
      address_line_2: fields.address_line_2 || null,
      city: fields.city || null,
      county: fields.county || null,
      postcode: fields.postcode || null,
      country: fields.country || 'United Kingdom',
      emergency_contact_1_name: fields.emergency_contact_1_name || null,
      emergency_contact_1_relationship: fields.emergency_contact_1_relationship || null,
      emergency_contact_1_email: fields.emergency_contact_1_email || null,
      emergency_contact_1_phone: fields.emergency_contact_1_phone || null,
      emergency_contact_2_name: fields.emergency_contact_2_name || null,
      emergency_contact_2_relationship: fields.emergency_contact_2_relationship || null,
      emergency_contact_2_email: fields.emergency_contact_2_email || null,
      emergency_contact_2_phone: fields.emergency_contact_2_phone || null,
      national_insurance: fields.national_insurance || null,
      bank_account_number: fields.bank_account_number || null,
      bank_sort_code: fields.bank_sort_code || null,
      bank_account_name: fields.bank_account_name || null,
      student_loan_status: fields.student_loan_status || null,
      tax_code: fields.tax_code || null,
      dietary_requirements: fields.dietary_requirements || null,
      accessibility_needs: fields.accessibility_needs || null,
    };

    await sbFetch(env, 'PATCH', `/core_employees?id=eq.${employee.id}`, updatePayload);

    // Create user_profiles record
    await sbFetch(env, 'POST', '/user_profiles', {
      user_id: authUser.id,
      company_id: employee.company_id,
      role: employee.role,
      full_name: employee.full_name,
      active: true,
    }, { Prefer: 'resolution=merge-duplicates,return=representation' });

    // Mark token as used
    await sbFetch(env, 'PATCH', `/core_onboarding_tokens?token=eq.${token}`, {
      used_at: new Date().toISOString(),
    });

    return json({ success: true });
  } catch (err) {
    console.error('complete-onboarding error:', err);
    return json({ error: err.message }, 500);
  }
}
