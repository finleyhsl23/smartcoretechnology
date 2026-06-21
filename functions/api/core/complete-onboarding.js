import { json, options, sbGet, sbPatch } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const { token, password, ...fields } = body;

    if (!token) return json({ error: 'Token required' }, 400);
    if (!password || password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);

    // Validate token
    const tokens = await sbGet(env, `/core_onboarding_tokens?token=eq.${encodeURIComponent(token)}&limit=1`);
    if (!tokens?.length) return json({ error: 'Invalid token' }, 404);
    const t = tokens[0];
    if (t.used_at) return json({ error: 'This link has already been used' }, 410);
    if (new Date(t.expires_at) < new Date()) return json({ error: 'This link has expired' }, 410);

    const emps = await sbGet(env, `/core_employees?id=eq.${t.employee_id}&limit=1`);
    if (!emps?.length) return json({ error: 'Employee not found' }, 404);
    const emp = emps[0];

    // Create Supabase auth user
    const authRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: fields.personal_email || t.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fields.full_name || emp.full_name },
      }),
    });

    if (!authRes.ok) {
      const err = await authRes.json();
      return json({ error: err.message || 'Failed to create account' }, 400);
    }
    const authUser = await authRes.json();

    // Update employee record
    const updateData = {
      auth_user_id: authUser.id,
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    };
    const allowedFields = [
      'full_name','title','preferred_name','pronouns','date_of_birth','gender',
      'personal_email','personal_phone','country_code',
      'address_line_1','address_line_2','city','county','postcode','country',
      'emergency_contact_1_name','emergency_contact_1_relationship','emergency_contact_1_email','emergency_contact_1_phone',
      'emergency_contact_2_name','emergency_contact_2_relationship','emergency_contact_2_email','emergency_contact_2_phone',
      'national_insurance','bank_account_number','bank_sort_code','bank_account_name',
      'student_loan_status','tax_code','dietary_requirements','accessibility_needs',
    ];
    for (const f of allowedFields) {
      if (fields[f] !== undefined) updateData[f] = fields[f] || null;
    }

    await sbPatch(env, `/core_employees?id=eq.${emp.id}`, updateData);

    // Create user_profiles record
    const profileData = {
      user_id: authUser.id,
      company_id: emp.company_id,
      role: emp.role || 'employee',
      full_name: fields.full_name || emp.full_name,
      active: true,
    };
    await fetch(`${env.SUPABASE_URL}/rest/v1/user_profiles`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(profileData),
    });

    // Mark token used
    await sbPatch(env, `/core_onboarding_tokens?token=eq.${encodeURIComponent(token)}`, { used_at: new Date().toISOString() });

    return json({ success: true });
  } catch (e) {
    console.error('complete-onboarding:', e);
    return json({ error: e.message }, 500);
  }
}
