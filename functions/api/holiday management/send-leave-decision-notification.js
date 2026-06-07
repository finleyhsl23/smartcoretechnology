import { jsonResponse, handleOptions, sendResendEmail, smartcoreEmailShell } from '../_utils.js';

export async function onRequestOptions() { return handleOptions(); }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.to) return jsonResponse({ error: 'Recipient email is required.' }, 400);

    const status = body.status === 'rejected' ? 'rejected' : 'approved';
    const html = smartcoreEmailShell({
      title: `Leave request ${status}`,
      intro: `Hello ${body.employee_name || 'there'}, your leave request has been ${status}.`,
      bodyHtml: `
        <p><strong>Leave type:</strong> ${body.leave_type || ''}</p>
        <p><strong>Dates:</strong> ${body.start_date || ''} to ${body.end_date || ''}</p>
        <p><strong>Total days:</strong> ${body.total_days || ''}</p>
        ${body.note ? `<p><strong>Note:</strong> ${body.note}</p>` : ''}
      `
    });

    const resend = await sendResendEmail(env, {
      to: body.to,
      subject: `Your leave request has been ${status}`,
      html
    });

    return jsonResponse({ ok: true, resend });
  } catch (error) {
    return jsonResponse({ error: error.message || 'Unable to send leave decision notification.', details: error.details || null }, 500);
  }
}
