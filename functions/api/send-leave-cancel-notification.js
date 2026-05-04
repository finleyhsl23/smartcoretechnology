export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    if (!env.RESEND_API_KEY) {
      return Response.json({ error: 'RESEND_API_KEY is missing.' }, { status: 500 });
    }

    const to =
      body.to ||
      body.authoriser_email ||
      body.employee_email ||
      env.LEAVE_ADMIN_EMAIL ||
      env.RESEND_FROM_EMAIL;

    if (!to) {
      return Response.json({ error: 'No recipient email provided.' }, { status: 400 });
    }

    const subject =
      body.type === 'admin_cancelled'
        ? 'Your leave has been cancelled'
        : 'Leave cancellation requested';

    const title =
      body.type === 'admin_cancelled'
        ? 'Leave cancelled by admin'
        : 'Leave cancellation request';

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || 'SmartCore Technology <support@smartcoretechnology.co.uk>',
        to,
        subject,
        html: `
          <div style="font-family:Arial,sans-serif;background:#07111f;color:#ffffff;padding:24px;">
            <div style="max-width:620px;margin:auto;background:#0b1628;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:24px;">
              <h1 style="margin-top:0;">${title}</h1>
              <p><strong>${body.employee_name || 'Employee'}</strong></p>
              <p>
                Type: ${body.leave_type || ''}<br>
                Start: ${body.start_date || ''}<br>
                End: ${body.end_date || ''}
              </p>
              ${body.reason ? `<p><strong>Reason:</strong> ${body.reason}</p>` : ''}
              ${
                body.manage_url
                  ? `<p><a href="${body.manage_url}" style="display:inline-block;background:#2d7cff;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:bold;">Open request</a></p>`
                  : ''
              }
              <p style="font-size:13px;color:#aab8d0;">SmartCore Technology</p>
            </div>
          </div>
        `
      })
    });

    const result = await response.json();

    if (!response.ok) {
      return Response.json({ error: result.message || 'Resend failed.', details: result }, { status: response.status });
    }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message || 'Unable to send email.' }, { status: 500 });
  }
}
