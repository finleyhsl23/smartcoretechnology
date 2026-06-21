import { json, options, getCallerProfile, sbGet } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    const url = new URL(request.url);
    const q = url.searchParams.get('q') || '';
    const roleFilter = url.searchParams.get('roles'); // e.g. "admin,owner"

    let path = `/core_employees?company_id=eq.${profile.company_id}&select=id,full_name,role,job_title`;
    if (q) path += `&full_name=ilike.*${encodeURIComponent(q)}*`;
    if (roleFilter) {
      const roles = roleFilter.split(',').map(r => `"${r.trim()}"`).join(',');
      path += `&role=in.(${roles})`;
    }
    path += '&order=full_name.asc&limit=10';

    const results = await sbGet(env, path);
    return json(results || []);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
