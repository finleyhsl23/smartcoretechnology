const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

async function hashPassword(password, email) {
  const enc = new TextEncoder();
  const data = enc.encode(password + ':' + email.toLowerCase());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

  const { email, password } = await request.json();
  if (!email || !password) return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: CORS });

  const password_hash = await hashPassword(password, email);

  // Find matching portal user
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/crm_portal_users?email=eq.${encodeURIComponent(email)}&password_hash=eq.${password_hash}&status=eq.active&select=*&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await res.json();
  if (!rows?.length) return new Response(JSON.stringify({ error: 'Invalid email or password' }), { status: 401, headers: CORS });

  const user = rows[0];
  const session_token = crypto.randomUUID();
  const session_expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Store session token
  await fetch(`${SUPABASE_URL}/rest/v1/crm_portal_users?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_token, session_expires_at, last_login_at: new Date().toISOString() }),
  });

  return new Response(JSON.stringify({
    session_token,
    user: { id: user.id, name: user.name, email: user.email, tenant_id: user.tenant_id, crm_company_id: user.crm_company_id },
  }), { status: 200, headers: CORS });
}
