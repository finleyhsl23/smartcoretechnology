import { json, bad, getUserFromRequest, audit } from './_utils.js';
export async function onRequestPost(context) {
  try {
    const actor = await getUserFromRequest(context.env, context.request);
    const body = await context.request.json();
    await audit(context.env, context.request, actor, body.action, body.target_table, body.target_id, body.metadata || {});
    return json({ ok: true });
  } catch (e) { return bad(e.message || 'Audit failed', 'audit'); }
}
