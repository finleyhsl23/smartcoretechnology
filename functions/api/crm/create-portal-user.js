// POST /api/crm/create-portal-user
// Body: { email, password, name, crm_company_id }
// Auth: Bearer <supabase CRM team token>

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = env.RESEND_API_KEY;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: corsHeaders });

  // Verify CRM team auth
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: corsHeaders });
  const userData = await userRes.json();

  // Get tenant_id from core_employees
  const empRes = await fetch(
    `${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${userData.id}&select=company_id,role&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const empRows = await empRes.json();
  const tenantId = empRows?.[0]?.company_id;
  const role = empRows?.[0]?.role;
  if (!tenantId) return new Response(JSON.stringify({ error: 'Employee not found' }), { status: 403, headers: corsHeaders });

  const { email, password, name, crm_company_id } = await request.json();
  if (!email || !password) return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400, headers: corsHeaders });

  // Check if portal user already exists for this tenant
  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/crm_portal_users?tenant_id=eq.${tenantId}&email=eq.${encodeURIComponent(email)}&limit=1`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const existing = await existingRes.json();
  if (existing?.length > 0) return new Response(JSON.stringify({ error: 'A portal user with this email already exists' }), { status: 409, headers: corsHeaders });

  // Create Supabase auth user
  const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, is_portal_user: true, tenant_id: tenantId },
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.json();
    return new Response(JSON.stringify({ error: err.msg || err.message || 'Failed to create user' }), { status: 400, headers: corsHeaders });
  }
  const newUser = await createRes.json();

  // Insert portal user record
  const portalRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_portal_users`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      auth_user_id: newUser.id,
      email,
      name: name || email,
      crm_company_id: crm_company_id || null,
      status: 'active',
      invited_at: new Date().toISOString(),
    }),
  });
  const portalUser = (await portalRes.json())?.[0];

  // Send welcome email via Resend if configured
  if (RESEND_API_KEY) {
    const portalUrl = 'https://smartcoretechnology.co.uk/systems/crm/portal-login.html';
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'SmartCore CRM <noreply@smartcoretechnology.co.uk>',
        to: [email],
        subject: 'Your Customer Portal Access',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:500px;margin:0 auto;padding:32px">
            <h2 style="color:#1e5cff">Welcome to the Customer Portal</h2>
            <p>Hi ${name || 'there'},</p>
            <p>Your portal account has been set up. You can now log in to create and track your support requests.</p>
            <div style="background:#f5f7ff;border:1px solid #dce3ff;border-radius:10px;padding:20px;margin:20px 0">
              <p style="margin:0 0 8px"><strong>Portal URL:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
              <p style="margin:0 0 8px"><strong>Email:</strong> ${email}</p>
              <p style="margin:0"><strong>Password:</strong> ${password}</p>
            </div>
            <p>We recommend changing your password after first login.</p>
            <a href="${portalUrl}" style="display:inline-block;background:#1e5cff;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600">Access Portal →</a>
          </div>
        `,
      }),
    }).catch(() => {}); // don't fail if email fails
  }

  return new Response(JSON.stringify({ success: true, portalUser, emailSent: !!RESEND_API_KEY }), { status: 200, headers: corsHeaders });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
