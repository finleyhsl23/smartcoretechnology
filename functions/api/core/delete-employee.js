import { json, options, getCallerProfile, sbGet, sbDelete } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);
    if (!['admin', 'owner'].includes(profile.role)) return json({ error: 'Forbidden — admin or owner required' }, 403);

    const { employee_id } = await request.json();
    if (!employee_id) return json({ error: 'employee_id is required' }, 400);

    const targets = await sbGet(env, `/core_employees?id=eq.${employee_id}&select=id,company_id&limit=1`);
    const target = targets?.[0];
    if (!target) return json({ error: 'Employee not found' }, 404);
    if (target.company_id !== profile.company_id) return json({ error: 'Forbidden' }, 403);

    // Cascades through every FK that references this row (audit submissions,
    // scores, photos, manager assignments, notes, disciplinary, training —
    // see the migrations for each table's ON DELETE CASCADE).
    await sbDelete(env, `/core_employees?id=eq.${employee_id}`);

    return json({ ok: true });
  } catch (e) {
    console.error('delete-employee:', e);
    return json({ error: e.message }, 500);
  }
}
