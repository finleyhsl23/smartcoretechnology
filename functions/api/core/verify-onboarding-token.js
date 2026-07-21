import { json, options, sbGet } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return json({ error: 'Token required' }, 400);

    const tokens = await sbGet(env, `/core_onboarding_tokens?token=eq.${encodeURIComponent(token)}&limit=1`);
    if (!tokens?.length) return json({ error: 'Invalid token' }, 404);

    const t = tokens[0];
    if (t.used_at) return json({ error: 'This link has already been used' }, 410);
    if (new Date(t.expires_at) < new Date()) return json({ error: 'This link has expired' }, 410);

    const emps = await sbGet(env, `/core_employees?id=eq.${t.employee_id}&limit=1`);
    if (!emps?.length) return json({ error: 'Employee not found' }, 404);
    const emp = emps[0];

    const [companies, configRows] = await Promise.all([
      sbGet(env, `/smartcore_core_companies?id=eq.${emp.company_id}&select=company_name&limit=1`),
      sbGet(env, `/core_onboarding_config?company_id=eq.${emp.company_id}&limit=1`),
    ]);
    const companyName = companies?.[0]?.company_name || '';
    const requiredFields = configRows?.[0]?.required_fields || {};

    // Check if the invite email already has a Supabase auth account
    const inviteEmail = t.email || emp.personal_email || emp.work_email || '';
    let existingAccount = false;
    if (inviteEmail) {
      try {
        const usersRes = await fetch(
          `${env.SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(inviteEmail)}&page=1&per_page=1`,
          { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
        );
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          existingAccount = (usersData?.users?.some(
            u => u.email?.toLowerCase() === inviteEmail.toLowerCase()
          ));
        }
      } catch (_) { /* non-fatal */ }
    }

    return json({
      employee_id: emp.id,
      company_id: emp.company_id,
      company_name: companyName,
      full_name: emp.full_name,
      personal_email: emp.personal_email,
      work_email: emp.work_email,
      invite_email: inviteEmail,
      role: emp.role,
      required_fields: requiredFields,
      existing_account: existingAccount,
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
