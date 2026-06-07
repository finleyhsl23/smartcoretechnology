import { jsonResponse, handleOptions, supabaseRequest, sendResendEmail, smartcoreEmailShell, getAppBaseUrl } from '../_utils.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const companyId = body.companyId || body.company_id;
    if (!companyId) return jsonResponse({ error: 'companyId is required.' }, 400);

    const params = new URLSearchParams({
      company_id: `eq.${companyId}`,
      invite_type: 'eq.owner',
      status: 'eq.active',
      select: '*,companies(company_name,display_name)',
      order: 'created_at.desc',
      limit: '1'
    });

    const rows = await supabaseRequest(env, `holidaymanagement.onboarding_invites?${params.toString()}`, { method: 'GET' });
    const invite = rows?.[0];
    if (!invite?.token) return jsonResponse({ error: 'No active owner invite found.' }, 404);

    const companyName = invite.companies?.display_name || invite.companies?.company_name || 'your company';
    const onboardingUrl = `${getAppBaseUrl(env)}/systems/holidaymanagement/onboarding.html?type=company&token=${encodeURIComponent(invite.token)}`;

    const html = smartcoreEmailShell({
      title: 'Your Holiday Management setup link',
      intro: `Here is your setup link for <strong>${companyName}</strong>.`,
      buttonText: 'Complete Setup',
      buttonUrl: onboardingUrl
    });

    const resend = await sendResendEmail(env, {
      to: invite.email,
      subject: `Complete your ${companyName} Holiday Management setup`,
      html
    });

    return jsonResponse({ ok: true, onboardingUrl, resend });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to resend company invite.', details: error.details || null }, 500);
  }
}
