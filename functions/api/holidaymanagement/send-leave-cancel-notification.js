import { jsonResponse, handleOptions, sendResendEmail, smartcoreEmailShell, getAppBaseUrl } from '../_utils.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.to) return jsonResponse({ error: 'Recipient email is required.' }, 400);

    const manageUrl = body.manage_url || `${getAppBaseUrl(env)}/systems/holidaymanagement/admin.html`;
    const html = smartcoreEmailShell({
      title: 'Leave cancellation request',
      intro: `${body.employee_name || 'An employee'} has requested to cancel approved leave.`,
      buttonText: 'Review Cancellation',
      buttonUrl: manageUrl,
      bodyHtml: `
        <p><strong>Dates:</strong> ${body.start_date || ''} to ${body.end_date || ''}</p>
        ${body.reason ? `<p><strong>Reason:</strong> ${body.reason}</p>` : ''}
      `
    });

    const resend = await sendResendEmail(env, {
      to: body.to,
      subject: `Leave cancellation request from ${body.employee_name || 'employee'}`,
      html
    });

    return jsonResponse({ ok: true, resend });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to send cancellation notification.', details: error.details || null }, 500);
  }
}
