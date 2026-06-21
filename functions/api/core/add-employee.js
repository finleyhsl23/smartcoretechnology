import { json, options, getCallerProfile, sbGet, sbPost } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);
    if (!['admin', 'owner'].includes(profile.role)) return json({ error: 'Forbidden — admin or owner required' }, 403);

    const body = await request.json();
    const {
      full_name, job_title, department_id, work_email, personal_email,
      personal_phone, country_code, employment_type, employment_type_custom,
      notice_period, role, annual_leave_allowance, executive_allowance_override,
      start_date, shift_pattern_id, authorizer_ids,
    } = body;

    if (!full_name?.trim()) return json({ error: 'Full name is required' }, 400);

    // Only owners can set owner role
    if (role === 'owner' && profile.role !== 'owner') {
      return json({ error: 'Only owners can assign the Owner role' }, 403);
    }

    // Generate unique employee_id: first 3 letters of company name + 9 random digits
    const companies = await sbGet(env, `/smartcore_core_companies?id=eq.${profile.company_id}&select=company_name&limit=1`);
    const companyName = companies?.[0]?.company_name || 'EMP';
    const prefix = companyName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');

    let employee_id;
    let attempts = 0;
    do {
      const digits = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
      employee_id = `${prefix}${digits}`;
      const existing = await sbGet(env, `/core_employees?employee_id=eq.${employee_id}&select=id&limit=1`);
      if (!existing?.length) break;
      attempts++;
    } while (attempts < 10);

    const [emp] = await sbPost(env, '/core_employees', {
      company_id: profile.company_id,
      employee_id,
      full_name: full_name.trim(),
      job_title: job_title || null,
      department_id: department_id || null,
      work_email: work_email || null,
      personal_email: personal_email || null,
      personal_phone: personal_phone || null,
      country_code: country_code || '+44',
      employment_type: employment_type || 'full_time',
      employment_type_custom: employment_type === 'other' ? employment_type_custom : null,
      notice_period: notice_period || null,
      role: role || 'employee',
      annual_leave_allowance: annual_leave_allowance || 28,
      executive_allowance_override: executive_allowance_override || null,
      start_date: start_date || null,
      shift_pattern_id: shift_pattern_id || null,
    });

    // Insert authorizers
    if (authorizer_ids?.length && emp?.id) {
      for (const auth_id of authorizer_ids) {
        try {
          await sbPost(env, '/core_employee_authorizers', {
            employee_id: emp.id,
            authorizer_employee_id: auth_id,
          });
        } catch (_) {}
      }
    }

    return json(emp, 201);
  } catch (e) {
    console.error('add-employee:', e);
    return json({ error: e.message }, 500);
  }
}
