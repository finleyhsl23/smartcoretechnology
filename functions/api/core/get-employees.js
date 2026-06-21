import { json, options, getCallerProfile, sbGet } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

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
