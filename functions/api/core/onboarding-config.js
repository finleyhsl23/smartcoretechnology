import { json, options, getCallerProfile, sbGet, sbPost, sbPatch } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);
    const rows = await sbGet(env, `/core_onboarding_config?company_id=eq.${profile.company_id}&limit=1`);
    return json(rows?.[0] || { required_fields: {} });
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

    const { required_fields } = await request.json();
    const rows = await sbGet(env, `/core_onboarding_config?company_id=eq.${profile.company_id}&limit=1`);

    if (rows?.length) {
      await sbPatch(env, `/core_onboarding_config?company_id=eq.${profile.company_id}`, {
        required_fields,
        updated_at: new Date().toISOString(),
      });
    } else {
      await sbPost(env, '/core_onboarding_config', { company_id: profile.company_id, required_fields });
    }
    return json({ success: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
