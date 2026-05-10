export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL env var');
    if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE env var');
    const auth = context.request.headers.get('authorization') || '';
    const body = await context.request.json();
    const headers = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };
    let actor_email = null, actor_name = null, actor_user_id = null;
    if (auth.startsWith('Bearer ')) {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE, Authorization: auth } });
      if (userRes.ok) {
        const u = await userRes.json();
        actor_email = u.email || null;
        actor_user_id = u.id || null;
      }
    }
    const staffRes = actor_user_id ? await fetch(`${SUPABASE_URL}/rest/v1/smartcore_staff?user_id=eq.${actor_user_id}&select=full_name`, { headers }) : null;
    if (staffRes?.ok) actor_name = (await staffRes.json())?.[0]?.full_name || null;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/audit_logs`, {
      method:'POST', headers: { ...headers, Prefer:'return=minimal' },
      body: JSON.stringify({ actor_user_id, actor_email, actor_name, action: body.action, target_table: body.target_table, target_id: body.target_id, metadata: body.metadata || {} })
    });
    if (!res.ok) throw new Error(await res.text());
    return json({ ok:true });
  } catch (err) { return json({ ok:false, error: err?.message || String(err) }, 400); }
}
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }); }
