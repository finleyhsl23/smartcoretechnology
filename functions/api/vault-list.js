export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL env var');
    if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE env var');
    const body = await context.request.json();
    if (!body.session_id) throw new Error('Missing vault session');
    const headers = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };
    const archived = body.show_archived ? 'true' : 'false';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vault_credentials?archived=eq.${archived}&select=*&order=updated_at.desc`, { headers });
    if (!res.ok) throw new Error(await res.text());
    return json({ ok: true, items: await res.json() });
  } catch (err) { return json({ ok:false, error: err?.message || String(err) }, 400); }
}
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }); }
