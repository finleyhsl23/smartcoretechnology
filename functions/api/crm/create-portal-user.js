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

  // Optional welcome email — fetch branding from crm_settings
  let emailSent = false;
  if (env.RESEND_API_KEY) {
    try {
      const portalUrl = `${new URL(request.url).origin}/systems/crm/portal-login.html`;

      // Fetch branding for tenant
      let branding = {};
      try {
        const bRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${tenantId}&select=branding&limit=1`, {
          headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        });
        const [bRow] = await bRes.json();
        branding = bRow?.branding || {};
      } catch (_) {}

      const companyName = branding.company_name || 'SmartCore Technology';
      const primaryColor = branding.primary_color || '#1e5cff';
      const logoUrl = branding.prefer_icon ? (branding.icon_url || branding.logo_url) : (branding.logo_url || branding.icon_url);

      const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f0f4ff;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:560px;width:100%">
        <!-- Header -->
        <tr>
          <td style="background:${primaryColor};padding:28px 36px;text-align:center">
            ${logoUrl
              ? `<img src="${logoUrl}" alt="${companyName}" style="max-height:52px;max-width:200px;object-fit:contain;display:block;margin:0 auto"/>`
              : `<div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">${companyName}</div>`
            }
            <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:6px">Customer Portal</div>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:36px 36px 24px">
            <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0a0f2e">Welcome, ${name || 'there'}! 👋</h2>
            <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6">Your customer portal account has been set up. You can now log in to view your projects, documents, and messages from <strong>${companyName}</strong>.</p>

            <div style="background:#f8f9fc;border-radius:12px;padding:20px 24px;margin-bottom:24px;border:1px solid #e5e7eb">
              <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;margin-bottom:14px">Your Login Details</div>
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="font-size:13px;color:#6b7280;padding:5px 0;width:80px">Email</td>
                  <td style="font-size:14px;font-weight:600;color:#1a1a2e;padding:5px 0">${email}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;color:#6b7280;padding:5px 0">Password</td>
                  <td style="font-size:14px;font-weight:600;color:#1a1a2e;padding:5px 0">${password}</td>
                </tr>
              </table>
            </div>

            <table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
              <a href="${portalUrl}" style="display:inline-block;background:${primaryColor};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:99px;letter-spacing:.2px">Access Your Portal →</a>
            </td></tr></table>

            <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;text-align:center">If you didn't expect this email, you can ignore it.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fc;border-top:1px solid #e5e7eb;padding:18px 36px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af">${companyName} · Powered by <a href="https://smartcoretechnology.co.uk" style="color:${primaryColor};text-decoration:none">SmartCore</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${companyName} <noreply@smartcoretechnology.co.uk>`,
          to: [email],
          subject: `Your ${companyName} Portal Access`,
          html: emailHtml,
        }),
      });
      emailSent = true;
    } catch (_) {}
  }

  return new Response(JSON.stringify({ success: true, portalUser, emailSent }), { status: 200, headers: CORS });
}
