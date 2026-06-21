import { json, options, getCallerProfile, sbGet, sbPost, sbPatch } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    // Ensure the caller has a core_employees record (owners who signed up may not have one)
    if (profile.auth_id) {
      const existing = await sbGet(env, `/core_employees?auth_user_id=eq.${profile.auth_id}&company_id=eq.${profile.company_id}&limit=1`);
      const derivedName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.auth_email || 'Owner';
      if (!existing?.length) {
        const companyRes = await sbGet(env, `/smartcore_core_companies?id=eq.${profile.company_id}&select=company_name,company_email,company_phone&limit=1`);
        const company = companyRes?.[0] || {};
        const companyName = company.company_name || 'EMP';
        const prefix = companyName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
        const digits = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
        const employee_id = `${prefix}${digits}`;
        await sbPost(env, '/core_employees', {
          company_id: profile.company_id,
          auth_user_id: profile.auth_id,
          employee_id,
          full_name: derivedName,
          work_email: profile.auth_email || company.company_email || null,
          personal_phone: profile.mobile_number?.replace(/^\+44\s*$/, '') || company.company_phone || null,
          role: profile.role || 'owner',
          onboarding_completed: true,
        });
      } else if (existing[0].full_name === 'Owner') {
        // Fix placeholder name from a previous bad creation
        const companyRes = await sbGet(env, `/smartcore_core_companies?id=eq.${profile.company_id}&select=company_email,company_phone&limit=1`);
        const company = companyRes?.[0] || {};
        await sbPatch(env, `/core_employees?auth_user_id=eq.${profile.auth_id}&company_id=eq.${profile.company_id}`, {
          full_name: derivedName,
          work_email: existing[0].work_email || profile.auth_email || company.company_email || null,
          personal_phone: existing[0].personal_phone || company.company_phone || null,
        });
      }
    }

    const [employees, departments, shiftPatterns, authorizers] = await Promise.all([
      sbGet(env, `/core_employees?company_id=eq.${profile.company_id}&order=full_name.asc`),
      sbGet(env, `/core_departments?company_id=eq.${profile.company_id}&order=name.asc`),
      sbGet(env, `/core_shift_patterns?company_id=eq.${profile.company_id}&order=name.asc`),
      sbGet(env, `/core_employee_authorizers?select=*,authorizer:authorizer_employee_id(id,full_name,role)`),
    ]);

    const deptMap = Object.fromEntries((departments || []).map(d => [d.id, d]));
    const shiftMap = Object.fromEntries((shiftPatterns || []).map(s => [s.id, s]));
    const authMap = {};
    for (const a of (authorizers || [])) {
      if (!authMap[a.employee_id]) authMap[a.employee_id] = [];
      authMap[a.employee_id].push(a.authorizer);
    }

    const enriched = (employees || []).map(e => ({
      ...e,
      department: e.department_id ? deptMap[e.department_id] : null,
      shift_pattern: e.shift_pattern_id ? shiftMap[e.shift_pattern_id] : null,
      authorizers: authMap[e.id] || [],
    }));

    return json(enriched);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
