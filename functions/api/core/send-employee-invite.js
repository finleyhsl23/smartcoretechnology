import { json, options, getCallerProfile, sbGet, sbPost } from './_auth.js';

const FROM = 'SmartCore <noreply@smartcoretechnology.co.uk>';
const SITE = 'https://smartcoretechnology.co.uk';

export const onRequestOptions = () => options();

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);
    if (!['admin', 'owner'].includes(profile.role)) return json({ error: 'Forbidden' }, 403);

    const { employee_id, send_to } = await request.json();
    if (!employee_id || !['personal', 'work'].includes(send_to)) {
      return json({ error: 'employee_id and send_to (personal|work) required' }, 400);
    }

    const emps = await sbGet(env, `/core_employees?id=eq.${employee_id}&company_id=eq.${profile.company_id}&limit=1`);
    if (!emps?.length) return json({ error: 'Employee not found' }, 404);
    const emp = emps[0];

    const email = send_to === 'personal' ? emp.personal_email : emp.work_email;
    if (!email) return json({ error: `No ${send_to} email set for this employee` }, 400);

    // Get company name
    const companies = await sbGet(env, `/smartcore_core_companies?id=eq.${profile.company_id}&select=company_name&limit=1`);
    const companyName = companies?.[0]?.company_name || 'Your Company';

    // Generate token
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

    // Invalidate previous tokens for this employee
    await fetch(`${env.SUPABASE_URL}/rest/v1/core_onboarding_tokens?employee_id=eq.${employee_id}`, {
      method: 'DELETE',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    });

    await sbPost(env, '/core_onboarding_tokens', {
      employee_id,
      token,
      email,
    });

    const link = `${SITE}/app/employee-onboarding.html?token=${token}`;
    const firstName = emp.full_name.split(' ')[0];

    const html = inviteHtml(firstName, companyName, link, email);

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: `You've been invited to join ${companyName} on SmartCore`,
        html,
      }),
    });
    if (!r.ok) throw new Error(await r.text());

    return json({ success: true, sent_to: email });
  } catch (e) {
    console.error('send-employee-invite:', e);
    return json({ error: e.message }, 500);
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inviteHtml(firstName, companyName, link, email) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Welcome to SmartCore</title>
</head>
<body style="margin:0;padding:0;background:#06060e;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#e0e0ea;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;font-size:0">You've been invited to join ${esc(companyName)} on SmartCore. Complete your onboarding to get started.</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06060e;padding:40px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.08);box-shadow:0 32px 80px rgba(0,0,0,.7)">

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#0b0b18 0%,#0f1529 60%,#0c1220 100%);padding:32px 40px;border-bottom:1px solid rgba(255,255,255,.07)">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:12px;vertical-align:middle">
          <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" width="42" height="42" style="display:block;border-radius:12px" />
        </td>
        <td style="vertical-align:middle">
          <div style="font-size:17px;font-weight:800;color:#f5f5f7;letter-spacing:-.03em">SmartCore</div>
          <div style="font-size:10px;color:rgba(255,255,255,.35);letter-spacing:.08em;text-transform:uppercase;margin-top:1px">Technology</div>
        </td>
      </tr></table>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="background:#0e0e18;padding:48px 40px;text-align:center">
      <div style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:rgba(91,143,255,.15);color:#5b8fff;border:1px solid rgba(91,143,255,.25);margin-bottom:24px">🎉 You're Invited</div>

      <h1 style="font-size:28px;font-weight:800;color:#f5f5f7;letter-spacing:-.04em;line-height:1.2;margin:0 0 12px">Welcome, ${esc(firstName)}!</h1>
      <p style="font-size:15px;color:#8a8a9e;line-height:1.75;margin:0 0 36px">
        <strong style="color:#c0c0d4">${esc(companyName)}</strong> has invited you to join their workspace on SmartCore.<br>
        Complete your onboarding to set up your account and get started.
      </p>

      <!-- CTA Button -->
      <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:16px 40px;border-radius:14px;letter-spacing:-.02em;margin-bottom:20px">
        Complete Your Onboarding →
      </a>

      <p style="font-size:12px;color:#52526e;margin:16px 0 36px">This link expires in 7 days and can only be used once.</p>

      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:20px 24px;text-align:left">
        <p style="font-size:13px;color:#7a7a96;line-height:1.75;margin:0">
          <strong style="color:#a0a0b4">Can't click the button?</strong> Copy and paste this link into your browser:<br>
          <span style="color:#5b8fff;word-break:break-all;font-size:12px">${link}</span>
        </p>
      </div>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:24px 40px;background:#09090f;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#52526e;text-align:center;line-height:2">
      SmartCore Technology &bull; <a href="${SITE}" style="color:#5b8fff;text-decoration:none">smartcoretechnology.co.uk</a><br>
      Sent to ${esc(email)} &bull; <a href="mailto:support@smartcoretechnology.co.uk" style="color:#5b8fff;text-decoration:none">support@smartcoretechnology.co.uk</a>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
