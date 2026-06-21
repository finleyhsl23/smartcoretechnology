import { json, options, getCallerProfile, sbGet, sbPost, sbPatch, sbDelete } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestPatch(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);
    if (!['admin', 'owner'].includes(profile.role)) return json({ error: 'Forbidden' }, 403);

    const body = await request.json();
    const { employee_id, authorizer_ids, ...fields } = body;

    if (!employee_id) return json({ error: 'employee_id required' }, 400);

    // Verify employee belongs to same company
    const emps = await sbGet(env, `/core_employees?id=eq.${employee_id}&company_id=eq.${profile.company_id}&limit=1`);
    if (!emps?.length) return json({ error: 'Employee not found' }, 404);

    // Only owners can set owner role
    if (fields.role === 'owner' && profile.role !== 'owner') {
      return json({ error: 'Only owners can assign the Owner role' }, 403);
    }

    // Patch the employee record
    const updateData = {};
    const allowed = [
      'full_name','job_title','department_id','work_email','personal_email',
      'personal_phone','employment_type','employment_type_custom','notice_period',
      'role','annual_leave_allowance','executive_allowance_override','start_date',
      'shift_pattern_id',
    ];
    for (const k of allowed) {
      if (k in fields) updateData[k] = fields[k];
    }
    if (fields.employment_type && fields.employment_type !== 'other') {
      updateData.employment_type_custom = null;
    }

    if (Object.keys(updateData).length) {
      await sbPatch(env, `/core_employees?id=eq.${employee_id}&company_id=eq.${profile.company_id}`, updateData);
    }

    // Update authorisers if provided
    if (Array.isArray(authorizer_ids)) {
      await sbDelete(env, `/core_employee_authorizers?employee_id=eq.${employee_id}`);
      for (const auth_id of authorizer_ids) {
        try {
          await sbPost(env, '/core_employee_authorizers', {
            employee_id,
            authorizer_employee_id: auth_id,
          });
        } catch (_) {}
      }
    }

    return json({ success: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
