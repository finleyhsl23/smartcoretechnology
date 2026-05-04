export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    if (!env.RESEND_API_KEY) {
      return Response.json({ error: 'RESEND_API_KEY is missing.' }, { status: 500 });
    }

    const to = body.to || body.employee_email;

    if (!to) {
      return Response.json({ error: 'No employee email provided.' }, { status: 400 });
    }

    const approved = body.status === 'approved';

    const subject = approved
      ? 'Your leave has been approved'
      : 'Your leave request has been rejected';

    const title = approved
      ? 'Leave approved'
      : 'Leave request rejected';

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
              <p>Hello ${body.employee_name || 'there'},</p>
              <p>Your ${body.leave_type || 'leave'} request has been <strong>${approved ? 'approved' : 'rejected'}</strong>.</p>
              <p>
                Start: ${body.start_date || ''}<br>
                End: ${body.end_date || ''}<br>
                Days: ${body.total_days || ''}
              </p>
              ${body.note ? `<p><strong>Note:</strong> ${body.note}</p>` : ''}
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
