/**
 * POST /api/send-invite
 *
 * Handles two actions:
 *   action: "send_employee_invite"  — creates invite token, sends onboarding email to new employee
 *   action: "create_company"        — creates company record, sends owner setup email
 *   action: "resend_owner_invite"   — resends setup email for an existing pending company
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY in env
 */

const SCHEMA = 'holidaymanagement';

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type':                 'application/json',
  };

  try {
    // Auth — require a valid Supabase JWT
    const authHeader = request.headers.get('Authorization') || '';
    const token      = authHeader.replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Unauthorised' }, 401, corsHeaders);

    const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization:  `Bearer ${token}`,
        apikey:         env.SUPABASE_SERVICE_KEY,
      },
    });
    if (!userRes.ok) return json({ error: 'Unauthorised' }, 401, corsHeaders);
    const caller = await userRes.json();

    const body = await request.json();
    const { action } = body;

    if (action === 'send_employee_invite') {
      return await handleEmployeeInvite(body, caller, env, corsHeaders);
    } else if (action === 'create_company') {
      return await handleCreateCompany(body, caller, env, corsHeaders);
    } else if (action === 'resend_owner_invite') {
      return await handleResendOwnerInvite(body, caller, env, corsHeaders);
    } else {
      return json({ error: 'Unknown action' }, 400, corsHeaders);
    }
  } catch (err) {
    console.error('send-invite error:', err);
    return json({ error: err.message || 'Internal error' }, 500, corsHeaders);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// ---------------------------------------------------------------------------
// Employee invite
// ---------------------------------------------------------------------------
async function handleEmployeeInvite(body, caller, env, headers) {
  const { company_id, employee_id } = body;
  if (!company_id || !employee_id) return json({ error: 'company_id and employee_id are required' }, 400, headers);

  // Verify caller belongs to this company and is admin/owner
  const membership = await supabaseGet(env, `/${SCHEMA}/company_users?user_id=eq.${caller.id}&company_id=eq.${company_id}&select=role&limit=1`);
  if (!membership?.length || !['admin','owner'].includes(membership[0].role)) {
    return json({ error: 'Forbidden' }, 403, headers);
  }

  // Load employee
  const employees = await supabaseGet(env, `/${SCHEMA}/employees?id=eq.${employee_id}&company_id=eq.${company_id}&select=*&limit=1`);
  if (!employees?.length) return json({ error: 'Employee not found' }, 404, headers);
  const employee = employees[0];

  // Load company
  const companies = await supabaseGet(env, `/${SCHEMA}/companies?id=eq.${company_id}&select=*&limit=1`);
  const company   = companies?.[0];

  // Create invite token (invalidate old ones first)
  await supabasePatch(env, `/${SCHEMA}/onboarding_invites?employee_id=eq.${employee_id}&used=eq.false`, { used: true });

  const token  = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await supabasePost(env, `/${SCHEMA}/onboarding_invites`, {
    company_id,
    employee_id,
    token,
    email:      employee.email,
    expires_at: expires,
    used:       false,
    created_by: caller.id,
  });

  // Build onboarding link
  const onboardLink = `https://smartcoretechnology.co.uk/systems/holidaymanagement/onboard/employee.html?token=${token}`;
  const companyName  = company?.display_name || company?.company_name || 'Your Company';
  const employeeName = employee.first_name || 'there';

  // Send email via Resend
  await sendEmail(env, {
    to:      employee.email,
    subject: `You've been added to ${companyName} — complete your profile`,
    html:    employeeInviteHtml({ employeeName, companyName, onboardLink, expires }),
  });

  // Update employee status to invited
  await supabasePatch(env, `/${SCHEMA}/employees?id=eq.${employee_id}`, { status: 'invited' });

  return json({ success: true, email: employee.email });
}

// ---------------------------------------------------------------------------
// Create company (SmartCore admin action)
// ---------------------------------------------------------------------------
async function handleCreateCompany(body, caller, env, headers) {
  // Must be SmartCore staff — check public.smartcore_staff table
  const staff = await supabaseGet(env, `/smartcore_staff?user_id=eq.${caller.id}&select=id&limit=1`, true);
  if (!staff?.length) return json({ error: 'Forbidden — SmartCore staff only' }, 403, headers);

  const { company_name, owner_name, owner_email, owner_phone, max_employees, plan_name, notes } = body;
  if (!company_name || !owner_name || !owner_email) {
    return json({ error: 'company_name, owner_name, and owner_email are required' }, 400, headers);
  }

  // Create company record
  const companyRows = await supabasePost(env, `/${SCHEMA}/companies`, {
    company_name,
    display_name:   company_name,
    owner_name,
    owner_email,
    owner_phone:    owner_phone || null,
    max_employees:  max_employees || null,
    plan_name:      plan_name || 'professional',
    notes:          notes || null,
    status:         'active',
    created_by_smartcore_user: caller.email || caller.id,
    created_at:     new Date().toISOString(),
  }, true);

  const company = Array.isArray(companyRows) ? companyRows[0] : companyRows;
  if (!company?.id) return json({ error: 'Failed to create company record' }, 500, headers);

  // Create invite token for the owner onboarding
  const token   = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days for owner

  await supabasePost(env, `/${SCHEMA}/onboarding_invites`, {
    company_id:  company.id,
    employee_id: null,
    token,
    email:       owner_email,
    expires_at:  expires,
    used:        false,
    invite_type: 'owner',
    created_by:  caller.id,
  });

  const onboardLink = `https://smartcoretechnology.co.uk/systems/holidaymanagement/onboard/company.html?token=${token}`;

  await sendEmail(env, {
    to:      owner_email,
    subject: `Welcome to SmartCore Holiday Management — set up ${company_name}`,
    html:    ownerInviteHtml({ ownerName: owner_name, companyName: company_name, onboardLink }),
  });

  return json({ success: true, company_id: company.id, email: owner_email });
}

// ---------------------------------------------------------------------------
// Resend owner invite
// ---------------------------------------------------------------------------
async function handleResendOwnerInvite(body, caller, env, headers) {
  const staff = await supabaseGet(env, `/smartcore_staff?user_id=eq.${caller.id}&select=id&limit=1`, true);
  if (!staff?.length) return json({ error: 'Forbidden' }, 403, headers);

  const { company_id, owner_email, owner_name } = body;
  if (!company_id || !owner_email) return json({ error: 'company_id and owner_email are required' }, 400, headers);

  const companies = await supabaseGet(env, `/${SCHEMA}/companies?id=eq.${company_id}&select=*&limit=1`);
  const company   = companies?.[0];
  if (!company) return json({ error: 'Company not found' }, 404, headers);

  // Invalidate old owner invites
  await supabasePatch(env, `/${SCHEMA}/onboarding_invites?company_id=eq.${company_id}&invite_type=eq.owner&used=eq.false`, { used: true });

  const token   = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await supabasePost(env, `/${SCHEMA}/onboarding_invites`, {
    company_id,
    employee_id: null,
    token,
    email:       owner_email,
    expires_at:  expires,
    used:        false,
    invite_type: 'owner',
    created_by:  caller.id,
  });

  const onboardLink = `https://smartcoretechnology.co.uk/systems/holidaymanagement/onboard/company.html?token=${token}`;
  await sendEmail(env, {
    to:      owner_email,
    subject: `Set up ${company.display_name || company.company_name} on SmartCore`,
    html:    ownerInviteHtml({ ownerName: owner_name || owner_email, companyName: company.display_name || company.company_name, onboardLink }),
  });

  return json({ success: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function supabaseGet(env, path, publicSchema = false) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey:          env.SUPABASE_SERVICE_KEY,
      Authorization:   `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Accept-Profile': publicSchema ? 'public' : SCHEMA,
    },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`DB GET error: ${t}`); }
  return res.json();
}

async function supabasePost(env, path, body, returning = false) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method:  'POST',
    headers: {
      apikey:           env.SUPABASE_SERVICE_KEY,
      Authorization:    `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Profile': SCHEMA,
      'Content-Type':   'application/json',
      Prefer:           returning ? 'return=representation' : 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`DB POST error: ${t}`); }
  if (returning) return res.json();
}

async function supabasePatch(env, path, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method:  'PATCH',
    headers: {
      apikey:           env.SUPABASE_SERVICE_KEY,
      Authorization:    `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Profile': SCHEMA,
      'Content-Type':   'application/json',
      Prefer:           'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`DB PATCH error: ${t}`); }
}

async function sendEmail(env, { to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'SmartCore <noreply@smartcoretechnology.co.uk>',
      to:      [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('Resend error:', t);
    throw new Error('Failed to send email');
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------
function emailWrapper(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#0f172a}
  .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.07)}
  .header{background:#080d1a;padding:28px 32px;display:flex;align-items:center;gap:12px}
  .header-logo{background:#3b82f6;width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center}
  .header-text{color:#fff;font-size:16px;font-weight:700}
  .body{padding:32px}
  h1{font-size:20px;font-weight:800;margin:0 0 8px}
  p{font-size:14px;line-height:1.7;color:#334155;margin:0 0 16px}
  .btn{display:inline-block;background:#3b82f6;color:#fff!important;text-decoration:none;font-weight:700;font-size:14px;padding:13px 28px;border-radius:8px;margin:8px 0 20px}
  .footer{padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center}
  .divider{height:1px;background:#e2e8f0;margin:24px 0}
  .note{background:#f1f5f9;border-radius:8px;padding:14px 16px;font-size:13px;color:#475569;margin-bottom:16px}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="header-logo">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="#fff" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
    </div>
    <div class="header-text">SmartCore Holiday Management</div>
  </div>
  <div class="body">${content}</div>
  <div class="footer">SmartCore Technology &bull; <a href="https://smartcoretechnology.co.uk" style="color:#3b82f6">smartcoretechnology.co.uk</a><br>This email was sent automatically. Do not reply to this address.</div>
</div>
</body>
</html>`;
}

function employeeInviteHtml({ employeeName, companyName, onboardLink, expires }) {
  const expiryDate = new Date(expires).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  return emailWrapper(`
    <h1>Welcome to ${companyName}!</h1>
    <p>Hi ${employeeName},</p>
    <p>You've been added to <strong>${companyName}</strong>'s holiday management system on SmartCore. To get started, please complete your profile — it only takes a couple of minutes.</p>
    <a href="${onboardLink}" class="btn">Complete My Profile</a>
    <div class="note">This link expires on <strong>${expiryDate}</strong>. If you need a new link, contact your manager.</div>
    <div class="divider"></div>
    <p style="font-size:13px;color:#94a3b8">Can't click the button? Copy and paste this link into your browser:<br><span style="word-break:break-all;color:#3b82f6">${onboardLink}</span></p>
  `);
}

function ownerInviteHtml({ ownerName, companyName, onboardLink }) {
  return emailWrapper(`
    <h1>Set up ${companyName}</h1>
    <p>Hi ${ownerName},</p>
    <p>SmartCore Technology has created a Holiday Management account for <strong>${companyName}</strong>. Click the button below to set up your account and configure your company settings.</p>
    <a href="${onboardLink}" class="btn">Set Up My Account</a>
    <div class="note"><strong>This is your personalised setup link.</strong> Do not share it — anyone with this link can complete your company setup.</div>
    <div class="divider"></div>
    <p style="font-size:13px;color:#64748b">Once you've set up your account you can invite your team members from within the app. If you have any questions, contact us at <a href="mailto:support@smartcoretechnology.co.uk" style="color:#3b82f6">support@smartcoretechnology.co.uk</a>.</p>
    <p style="font-size:13px;color:#94a3b8">Can't click the button? Copy and paste this link:<br><span style="word-break:break-all;color:#3b82f6">${onboardLink}</span></p>
  `);
}
