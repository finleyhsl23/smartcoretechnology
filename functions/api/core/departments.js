import { json, options, getCallerProfile, sbGet, sbPost, sbDelete, sbPatch } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    const depts = await sbGet(env, `/core_departments?company_id=eq.${profile.company_id}&order=name.asc`);

    // Get employee counts per department
    const emps = await sbGet(env, `/core_employees?company_id=eq.${profile.company_id}&select=department_id`);
    const counts = {};
    for (const e of emps) {
      if (e.department_id) counts[e.department_id] = (counts[e.department_id] || 0) + 1;
    }

    return json(depts.map(d => ({ ...d, employee_count: counts[d.id] || 0 })));
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);
    if (!['admin', 'owner'].includes(profile.role)) return json({ error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'reassign') {
      const { employee_id, new_department_id } = await request.json();
      await sbPatch(env, `/core_employees?id=eq.${employee_id}`, { department_id: new_department_id || null });
      return json({ success: true });
    }

    const { name } = await request.json();
    if (!name?.trim()) return json({ error: 'Name required' }, 400);

    const [dept] = await sbPost(env, '/core_departments', { company_id: profile.company_id, name: name.trim() });
    return json(dept, 201);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);
    if (!['admin', 'owner'].includes(profile.role)) return json({ error: 'Forbidden' }, 403);

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'id required' }, 400);

    // Verify belongs to company
    const depts = await sbGet(env, `/core_departments?id=eq.${id}&company_id=eq.${profile.company_id}&limit=1`);
    if (!depts?.length) return json({ error: 'Not found' }, 404);

    // Check employees still in this dept
    const emps = await sbGet(env, `/core_employees?department_id=eq.${id}&company_id=eq.${profile.company_id}&select=id,full_name`);
    if (emps?.length) return json({ error: 'Department has employees', employees: emps }, 409);

    await sbDelete(env, `/core_departments?id=eq.${id}`);
    return json({ success: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
