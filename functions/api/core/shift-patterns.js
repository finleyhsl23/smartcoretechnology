import { json, options, getCallerProfile, sbGet, sbPost, sbDelete } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);
    const patterns = await sbGet(env, `/core_shift_patterns?company_id=eq.${profile.company_id}&order=name.asc`);
    return json(patterns);
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

    const { name, schedule } = await request.json();
    if (!name?.trim()) return json({ error: 'Name required' }, 400);

    const [pattern] = await sbPost(env, '/core_shift_patterns', {
      company_id: profile.company_id,
      name: name.trim(),
      schedule: schedule || {},
    });
    return json(pattern, 201);
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

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'id required' }, 400);

    const rows = await sbGet(env, `/core_shift_patterns?id=eq.${id}&company_id=eq.${profile.company_id}&limit=1`);
    if (!rows?.length) return json({ error: 'Not found' }, 404);

    await sbDelete(env, `/core_shift_patterns?id=eq.${id}`);
    return json({ success: true });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
