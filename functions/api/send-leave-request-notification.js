export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    if (!body.to) {
      return Response.json({ error: 'Missing authoriser email.' }, { status: 400 });
    }

    if (!env.RESEND_API_KEY) {
      return Response.json({ error: 'RESEND_API_KEY is missing.' }, { status: 500 });
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || 'SmartCore Technology <support@smartcoretechnology.co.uk>',
        to: body.to,
        subject: `Leave request submitted by ${body.employee_name}`,
        html: `
          <div style="font-family:Arial,sans-serif;background:#07111f;color:#ffffff;padding:24px;">
            <div style="max-width:620px;margin:auto;background:#0b1628;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:24px;">
              <h1 style="margin-top:0;">New leave request</h1>
              <p>Hello ${body.authoriser_name || 'there'},</p>
              <p><strong>${body.employee_name}</strong> has submitted a leave request.</p>
              <p>
                Type: ${body.leave_type}<br>
                Start: ${body.start_date}<br>
                End: ${body.end_date}<br>
                Total days: ${body.total_days}
              </p>
              <p>
                <a href="${body.manage_url}" style="display:inline-block;background:#2d7cff;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:bold;">
                  Open and manage request
                </a>
              </p>
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
    return Response.json({ error: error.message || 'Unable to send notification.' }, { status: 500 });
  }
}
