const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: CORS });

  // Verify CRM team auth
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: CORS });
  const { id: authUserId } = await userRes.json();

  // Get tenant_id
  const empRes = await fetch(`${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${authUserId}&select=company_id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [emp] = await empRes.json();
  if (!emp) return new Response(JSON.stringify({ error: 'Employee not found' }), { status: 403, headers: CORS });
  const tenantId = emp.company_id;

  const { email, password, name, crm_company_id } = await request.json();
  if (!email || !password) return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: CORS });

  // Check duplicate
  const dupRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_portal_users?tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}&select=id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const dups = await dupRes.json();
  if (dups?.length > 0) return new Response(JSON.stringify({ error: 'A portal user with this email already exists' }), { status: 409, headers: CORS });

  const password_hash = await hashPassword(password, email);

  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_portal_users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      tenant_id: tenantId,
      email,
      name: name || email,
      password_hash,
      crm_company_id: crm_company_id || null,
      status: 'active',
      invited_at: new Date().toISOString(),
    }),
  });
  if (!insRes.ok) {
    const err = await insRes.json();
    return new Response(JSON.stringify({ error: err.message || 'Failed to create user' }), { status: 500, headers: CORS });
  }
  const [portalUser] = await insRes.json();

  // Optional welcome email
  let emailSent = false;
  if (env.RESEND_API_KEY) {
    try {
      const portalUrl = `${new URL(request.url).origin}/systems/crm/portal-login.html`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'SmartCore CRM <noreply@smartcoretechnology.co.uk>',
          to: [email],
          subject: 'Your Customer Portal Access',
          html: `<p>Hi ${name || 'there'},</p><p><strong>Portal URL:</strong> <a href="${portalUrl}">${portalUrl}</a><br><strong>Email:</strong> ${email}<br><strong>Password:</strong> ${password}</p>`,
        }),
      });
      emailSent = true;
    } catch (_) {}
  }

  return new Response(JSON.stringify({ success: true, portalUser, emailSent }), { status: 200, headers: CORS });
}
