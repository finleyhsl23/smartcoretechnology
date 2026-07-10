import { json, options, getCallerProfile, sbGet } from './_auth.js';

const FROM = 'SmartCore <noreply@smartcoretechnology.co.uk>';
const SITE = 'https://smartcoretechnology.co.uk';

export const onRequestOptions = () => options();

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);
    if (!['admin', 'owner'].includes(profile.role)) return json({ error: 'Forbidden' }, 403);

    const { employee_id } = await request.json();
    if (!employee_id) return json({ error: 'employee_id required' }, 400);

    // Fetch employee (must belong to same company)
    const emps = await sbGet(env, `/core_employees?id=eq.${employee_id}&company_id=eq.${profile.company_id}&select=id,full_name,work_email,auth_user_id&limit=1`);
    if (!emps?.length) return json({ error: 'Employee not found' }, 404);
    const emp = emps[0];

    if (!emp.work_email) return json({ error: 'Employee has no work email set' }, 400);
    if (!emp.auth_user_id) return json({ error: 'Employee has no login account yet — send an onboarding invite first' }, 400);

    // Generate a password recovery link via Supabase Admin API
    const linkRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'recovery',
        email: emp.work_email,
        redirect_to: `${SITE}/reset-password/`,
      }),
    });

    const linkData = await linkRes.json();
    if (!linkRes.ok || !linkData.action_link) {
      throw new Error(linkData.message || linkData.error || 'Failed to generate reset link');
    }

    const resetLink = linkData.action_link;
    const firstName = emp.full_name.split(' ')[0];

    // Get company name
    const companies = await sbGet(env, `/smartcore_core_companies?id=eq.${profile.company_id}&select=company_name&limit=1`);
    const companyName = companies?.[0]?.company_name || 'Your Company';

    const html = resetHtml(firstName, companyName, resetLink, emp.work_email);

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [emp.work_email],
        subject: 'Reset your SmartCore password',
        html,
      }),
    });
    if (!r.ok) throw new Error(await r.text());

    return json({ success: true, sent_to: emp.work_email });
  } catch (e) {
    console.error('send-password-reset:', e);
    return json({ error: e.message }, 500);
  }
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function resetHtml(firstName, companyName, link, email) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset your SmartCore password</title>
</head>
<body style="margin:0;padding:0;background:#06060e;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#e0e0ea;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;font-size:0">Reset your SmartCore password — this link expires in 1 hour.</div>
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
      <div style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:rgba(255,159,10,.12);color:#ff9f0a;border:1px solid rgba(255,159,10,.25);margin-bottom:24px">🔐 Password Reset</div>

      <h1 style="font-size:28px;font-weight:800;color:#f5f5f7;letter-spacing:-.04em;line-height:1.2;margin:0 0 12px">Reset your password</h1>
      <p style="font-size:15px;color:#8a8a9e;line-height:1.75;margin:0 0 36px">
        Hi ${esc(firstName)}, your administrator at <strong style="color:#c0c0d4">${esc(companyName)}</strong> has sent you a password reset link for your SmartCore account.<br>
        Click below to choose a new password.
      </p>

      <!-- CTA Button -->
      <a href="${link}" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:16px 40px;border-radius:14px;letter-spacing:-.02em;margin-bottom:20px">
        Reset My Password →
      </a>

      <p style="font-size:12px;color:#52526e;margin:16px 0 36px">This link expires in <strong style="color:#8a8a9e">1 hour</strong> and can only be used once.<br>If you didn't request this, you can safely ignore this email.</p>

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
