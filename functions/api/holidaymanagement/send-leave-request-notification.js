import { jsonResponse, handleOptions, sendResendEmail, smartcoreEmailShell, getAppBaseUrl } from '../_utils.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.to) return jsonResponse({ error: 'Recipient email is required.' }, 400);

    const manageUrl = body.manage_url || `${getAppBaseUrl(env)}/systems/holidaymanagement/admin.html`;
    const html = smartcoreEmailShell({
      title: 'New leave request',
      intro: `${body.employee_name || 'An employee'} has submitted a ${body.leave_type || 'leave'} request.`,
      buttonText: 'Review Request',
      buttonUrl: manageUrl,
      bodyHtml: `
        <p><strong>Dates:</strong> ${body.start_date || ''} to ${body.end_date || ''}</p>
        <p><strong>Total days:</strong> ${body.total_days || ''}</p>
        <p><strong>Day type:</strong> ${body.day_type || 'full'}</p>
      `
    });

    const resend = await sendResendEmail(env, {
      to: body.to,
      subject: `Leave request from ${body.employee_name || 'employee'}`,
      html
    });

    return jsonResponse({ ok: true, resend });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to send leave request notification.', details: error.details || null }, 500);
  }
}
