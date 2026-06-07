import { jsonResponse, handleOptions, supabaseRpc, sendResendEmail, smartcoreEmailShell, getAppBaseUrl } from '../_utils.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const employeeId = body.employeeId || body.employee_id;
    const email = String(body.email || '').trim().toLowerCase();
    const employeeName = body.employeeName || body.employee_name || 'there';
    const companyName = body.companyName || body.company_name || 'your company';

    if (!employeeId || !email) return jsonResponse({ error: 'employeeId and email are required.' }, 400);

    const rpcResult = await supabaseRpc(env, 'holidaymanagement.create_employee_invite', {
      p_employee_id: employeeId,
      p_email: email
    });

    const token = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    const onboardingUrl = `${getAppBaseUrl(env)}/systems/holidaymanagement/onboarding.html?type=employee&token=${encodeURIComponent(token)}`;

    const html = smartcoreEmailShell({
      title: 'Complete your employee onboarding',
      intro: `Hello ${employeeName}, you have been invited to complete your Holiday Management onboarding for <strong>${companyName}</strong>.`,
      buttonText: 'Complete Onboarding',
      buttonUrl: onboardingUrl,
      bodyHtml: '<p style="font-size:15px;line-height:1.6;">You will be asked to confirm your personal details, address and emergency contact information.</p>'
    });

    const resend = await sendResendEmail(env, {
      to: email,
      subject: `Complete your ${companyName} Holiday Management onboarding`,
      html
    });

    return jsonResponse({ ok: true, token, onboardingUrl, resend });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to send employee invite.', details: error.details || null }, 500);
  }
}
