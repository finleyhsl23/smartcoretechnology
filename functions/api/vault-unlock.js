export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    const VAULT_CODE = context.env.VAULT_CODE;
    if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL env var');
    if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE env var');
    if (!VAULT_CODE) throw new Error('Missing VAULT_CODE env var');
    const body = await context.request.json();
    if (String(body.code || '') !== String(VAULT_CODE)) throw new Error('Incorrect vault code');
    const id = crypto.randomUUID();
    const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const headers = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vault_sessions`, { method:'POST', headers, body: JSON.stringify({ id, expires_at }) });
    if (!res.ok) throw new Error(await res.text());
    return json({ ok:true, session_id:id });
  } catch (err) { return json({ ok:false, error: err?.message || String(err) }, 400); }
}
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }); }
