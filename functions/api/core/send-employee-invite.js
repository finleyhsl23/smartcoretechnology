/**
 * POST /api/core/send-employee-invite
 * Admin/owner only — generates an onboarding token and sends invite email.
 * Body: { employee_id, send_to: 'personal'|'work' }
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function sbFetch(env, method, path, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text);
}

async function getCaller(request, env) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_KEY },
  });
  if (!res.ok) return null;
  const user = await res.json();
  const profiles = await sbFetch(env, 'GET', `/user_profiles?user_id=eq.${user.id}&select=*&limit=1`);
  return profiles?.[0] || null;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const caller = await getCaller(request, env);
    if (!caller) return json({ error: 'Unauthorised' }, 401);
    if (!['admin', 'owner'].includes(caller.role)) return json({ error: 'Forbidden' }, 403);

    const { employee_id, send_to = 'personal' } = await request.json();
    if (!employee_id) return json({ error: 'employee_id is required' }, 400);

    const employees = await sbFetch(env, 'GET',
      `/core_employees?id=eq.${employee_id}&company_id=eq.${caller.company_id}&select=*&limit=1`
    );
    const employee = employees?.[0];
    if (!employee) return json({ error: 'Employee not found' }, 404);

    const email = send_to === 'work' ? employee.work_email : employee.personal_email;
    if (!email) return json({ error: `No ${send_to} email address on file` }, 400);

    const companies = await sbFetch(env, 'GET',
      `/companies?id=eq.${caller.company_id}&select=name&limit=1`
    );
    const companyName = companies?.[0]?.name || 'Your Company';

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await sbFetch(env, 'POST', '/core_onboarding_tokens', {
      employee_id,
      token,
      email,
      expires_at: expiresAt,
    });

    const onboardingUrl = `https://smartcoretechnology.co.uk/app/employee-onboarding.html?token=${token}`;

    const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#020617;font-family:Inter,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020617;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(180deg,#06153a,#020617);border:1px solid rgba(255,255,255,.12);border-radius:22px 22px 0 0;padding:32px 40px;text-align:center;">
            <div style="width:14px;height:14px;border-radius:999px;background:radial-gradient(circle at 30% 30%,#fff,rgba(255,255,255,.15) 28%,#1e5cff 70%);display:inline-block;margin-bottom:12px;"></div>
            <h1 style="margin:0;font-size:13px;letter-spacing:1px;color:#eaf0ff;text-transform:uppercase;font-weight:700;">SmartCore Technology</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.045));border-left:1px solid rgba(255,255,255,.12);border-right:1px solid rgba(255,255,255,.12);padding:40px;">
            <h2 style="margin:0 0 8px;font-size:24px;color:#eaf0ff;font-weight:700;">Welcome to ${companyName}!</h2>
            <p style="margin:0 0 24px;font-size:15px;color:rgba(234,240,255,.7);line-height:1.6;">Hi ${employee.full_name},</p>
            <p style="margin:0 0 24px;font-size:15px;color:rgba(234,240,255,.7);line-height:1.6;">
              You've been added to ${companyName}'s employee management system. Please complete your onboarding to set up your account and provide your details.
            </p>
            <p style="margin:0 0 32px;font-size:15px;color:rgba(234,240,255,.7);line-height:1.6;">
              This link will expire in <strong style="color:#eaf0ff;">7 days</strong>.
            </p>
            <div style="text-align:center;margin-bottom:32px;">
              <a href="${onboardingUrl}" style="display:inline-block;background:linear-gradient(180deg,#3b82f6,#2563eb);color:#fff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:14px;text-decoration:none;letter-spacing:.3px;">
                Complete Your Onboarding →
              </a>
            </div>
            <p style="margin:0;font-size:13px;color:rgba(234,240,255,.4);line-height:1.6;">
              If the button doesn't work, copy and paste this link:<br>
              <a href="${onboardingUrl}" style="color:#3b82f6;word-break:break-all;">${onboardingUrl}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-top:none;border-radius:0 0 22px 22px;padding:20px 40px;text-align:center;">
            <p style="margin:0;font-size:12px;color:rgba(234,240,255,.35);">
              SmartCore Technology · <a href="https://smartcoretechnology.co.uk" style="color:rgba(234,240,255,.35);">smartcoretechnology.co.uk</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SmartCore Technology <noreply@smartcoretechnology.co.uk>',
        to: [email],
        subject: `Complete Your Employee Onboarding — ${companyName}`,
        html: emailHtml,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error('Resend error:', errText);
      return json({ error: 'Failed to send email' }, 500);
    }

    return json({ success: true, email_sent_to: email });
  } catch (err) {
    console.error('send-employee-invite error:', err);
    return json({ error: err.message }, 500);
  }
}
