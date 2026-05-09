import { json, bad, supaHeaders, getUserFromRequest, audit } from './_utils.js';
export async function onRequestPost(context) {
  try {
    const env = context.env;
    const actor = await getUserFromRequest(env, context.request);
    if (!actor) throw new Error('Not signed in');
    const { code } = await context.request.json();
    if (!env.VAULT_CODE) throw new Error('Missing VAULT_CODE env var');
    if (String(code) !== String(env.VAULT_CODE)) throw new Error('Incorrect vault code');
    const session_id = crypto.randomUUID();
    const expires_at = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await fetch(`${env.SUPABASE_URL}/rest/v1/vault_sessions`, { method:'POST', headers:{...supaHeaders(env),Prefer:'return=minimal'}, body:JSON.stringify({ id:session_id, user_id:actor.id, expires_at }) });
    await audit(env, context.request, actor, 'unlock_vault', 'vault_sessions', session_id, {});
    return json({ ok:true, session_id });
  } catch(e) { return bad(e.message || 'Unlock failed','vault_unlock'); }
}
