export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL env var');
    if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE env var');

    const body = await context.request.json();
    const session_id = body.session_id;
    if (!session_id) throw new Error('Missing vault session');

    const headers = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };

    const sessRes = await fetch(`${SUPABASE_URL}/rest/v1/vault_sessions?id=eq.${encodeURIComponent(session_id)}&select=*`, { headers });
    if (!sessRes.ok) throw new Error(await sessRes.text());
    const sessions = await sessRes.json();
    const session = sessions?.[0];
    if (!session) throw new Error('Vault session not found');
    if (session.expires_at && new Date(session.expires_at) < new Date()) throw new Error('Vault session expired');

    const payload = {
      name: body.name,
      username: body.username || null,
      email: body.email || null,
      password: body.password || null,
      details: body.details || {},
      archived: body.archived === undefined ? false : !!body.archived,
      updated_at: new Date().toISOString()
    };

    let res;
    if (body.id) {
      const patch = {};
      Object.keys(payload).forEach(k => { if (body[k] !== undefined || k === 'archived' || k === 'updated_at') patch[k] = payload[k]; });
      res = await fetch(`${SUPABASE_URL}/rest/v1/vault_credentials?id=eq.${encodeURIComponent(body.id)}`, {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(patch)
      });
    } else {
      if (!payload.name) throw new Error('Credential name is required');
      res = await fetch(`${SUPABASE_URL}/rest/v1/vault_credentials`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(payload)
      });
    }
    if (!res.ok) throw new Error(await res.text());
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err?.message || String(err) }, 400);
  }
}
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }); }
