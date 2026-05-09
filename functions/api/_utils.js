export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
export function bad(error, stage = 'error', status = 400, details = null) {
  return json({ ok: false, error, stage, details }, status);
}
export function supaHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`, 'content-type': 'application/json' };
}
export async function getUserFromRequest(env, request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON || env.SUPABASE_SERVICE_ROLE, Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return await res.json();
}
export async function audit(env, request, actor, action, target_table, target_id, metadata = {}) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/audit_logs`, {
      method: 'POST', headers: { ...supaHeaders(env), Prefer: 'return=minimal' },
      body: JSON.stringify({ actor_user_id: actor?.id || null, actor_email: actor?.email || null, action, target_table, target_id: target_id ? String(target_id) : null, metadata, ip_address: request.headers.get('cf-connecting-ip'), user_agent: request.headers.get('user-agent') })
    });
  } catch (_) {}
}
export function escapeHtml(s) { return String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
