import { jsonResponse, handleOptions, supabaseRpc, sendResendEmail, smartcoreEmailShell, getAppBaseUrl } from '../_utils.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const companyName = String(body.companyName || body.company_name || '').trim();
    const ownerName = String(body.ownerName || body.owner_name || '').trim();
    const ownerEmail = String(body.ownerEmail || body.owner_email || '').trim().toLowerCase();
    const maxEmployees = Number(body.maxEmployees || body.max_employees || 25);
    const notes = String(body.notes || '').trim();

    if (!companyName || !ownerEmail) {
      return jsonResponse({ error: 'Company name and owner email are required.' }, 400);
    }

    const rpcResult = await supabaseRpc(env, 'holidaymanagement.smartcore_add_company', {
      payload: {
        company_name: companyName,
        owner_name: ownerName,
        owner_email: ownerEmail,
        max_employees: maxEmployees,
        notes
      }
    });

    const companyId = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;

    const inviteRows = await fetchLatestInvite(env, ownerEmail, companyId);
    const invite = inviteRows?.[0];

    if (!invite?.token) {
      return jsonResponse({
        ok: true,
        companyId,
        warning: 'Company was created, but the invite token could not be found to send the email.'
      });
    }

    const onboardingUrl = `${getAppBaseUrl(env)}/systems/holidaymanagement/onboarding.html?type=company&token=${encodeURIComponent(invite.token)}`;

    const html = smartcoreEmailShell({
      title: 'Complete your Holiday Management setup',
      intro: `Hello ${ownerName || 'there'}, SmartCore Technology has created a Holiday Management portal for <strong>${companyName}</strong>.`,
      buttonText: 'Complete Setup',
      buttonUrl: onboardingUrl,
      bodyHtml: '<p style="font-size:15px;line-height:1.6;">Please use the button below to complete your company setup and create your owner profile.</p>'
    });

    const resend = await sendResendEmail(env, {
      to: ownerEmail,
      subject: `Complete your ${companyName} Holiday Management setup`,
      html
    });

    return jsonResponse({ ok: true, companyId, inviteId: invite.id, onboardingUrl, resend });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to add company.', details: error.details || null }, 500);
  }
}

async function fetchLatestInvite(env, ownerEmail, companyId) {
  const { supabaseRequest } = await import('../_utils.js');
  const params = new URLSearchParams();
  params.set('email', `eq.${ownerEmail}`);
  if (companyId) params.set('company_id', `eq.${companyId}`);
  params.set('invite_type', 'eq.owner');
  params.set('select', '*');
  params.set('order', 'created_at.desc');
  params.set('limit', '1');
  return supabaseRequest(env, `holidaymanagement.onboarding_invites?${params.toString()}`, { method: 'GET' });
}
