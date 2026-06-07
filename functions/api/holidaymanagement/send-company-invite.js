import { jsonResponse, handleOptions, sendResendEmail, smartcoreEmailShell, getAppBaseUrl } from '../_utils.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const ownerEmail = String(body.ownerEmail || body.owner_email || '').trim().toLowerCase();
    const ownerName = String(body.ownerName || body.owner_name || '').trim();
    const companyName = String(body.companyName || body.company_name || '').trim();
    const token = String(body.token || '').trim();

    if (!ownerEmail || !companyName || !token) {
      return jsonResponse({ error: 'Missing ownerEmail, companyName or token.' }, 400);
    }

    const onboardingUrl = `${getAppBaseUrl(env)}/systems/holidaymanagement/onboarding.html?type=company&token=${encodeURIComponent(token)}`;
    const html = smartcoreEmailShell({
      title: 'Complete your Holiday Management setup',
      intro: `Hello ${ownerName || 'there'}, SmartCore Technology has created a Holiday Management portal for <strong>${companyName}</strong>.`,
      buttonText: 'Complete Setup',
      buttonUrl: onboardingUrl,
      bodyHtml: '<p style="font-size:15px;line-height:1.6;">Please complete the setup link to activate your company account.</p>'
    });

    const resend = await sendResendEmail(env, {
      to: ownerEmail,
      subject: `Complete your ${companyName} Holiday Management setup`,
      html
    });

    return jsonResponse({ ok: true, onboardingUrl, resend });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to send company invite.', details: error.details || null }, 500);
  }
}
