import { json, options, getCallerProfile, sbGet, sbPatch } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    // Look up core_employees record by auth_user_id
    const emps = await sbGet(env, `/core_employees?auth_user_id=eq.${profile.auth_id}&company_id=eq.${profile.company_id}&limit=1`);
    if (!emps?.length) return json({ error: 'Employee record not found' }, 404);

    return json(emps[0]);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    const body = await request.json();

    // Employees can only update their own non-sensitive personal details
    const allowed = [
      'pronouns', 'gender', 'date_of_birth',
      'address_line_1', 'address_line_2', 'city', 'county', 'postcode', 'country',
      'personal_email', 'personal_phone',
      'dietary_requirements', 'accessibility_needs',
    ];
    const updateData = {};
    for (const k of allowed) {
      if (k in body) updateData[k] = body[k];
    }

    if (!Object.keys(updateData).length) return json({ error: 'No valid fields provided' }, 400);

    await sbPatch(env, `/core_employees?auth_user_id=eq.${profile.auth_id}&company_id=eq.${profile.company_id}`, updateData);
    return json({ success: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
