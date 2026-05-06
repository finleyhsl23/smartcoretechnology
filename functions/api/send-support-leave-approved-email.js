export async function onRequestPost(context) {
  try {
    const { RESEND_API_KEY } = context.env;

    if (!RESEND_API_KEY) {
      return json({ error: 'Missing RESEND_API_KEY.' }, 500);
    }

    const body = await context.request.json().catch(() => ({}));

    const employeeName = body.employee_name || 'Employee';
    const startDate = formatDate(body.start_date);
    const endDate = formatDate(body.end_date);
    const action = body.action || 'approved';

    const subject =
      action === 'cancelled'
        ? `Leave Cancelled - ${employeeName}`
        : `Leave Approved - ${employeeName}`;

    const emailBody =
      action === 'cancelled'
        ? `
          <p>Hi Smartfits Support Team,</p>

          <p><strong>${employeeName}</strong>'s leave from <strong>${startDate}</strong> to <strong>${endDate}</strong> has been cancelled.</p>

          <p>Please make sure this is updated in Smartfits' systems, and that they are no longer blocked out for these dates.</p>

          <p>Thank you,<br>
          The SmartCore and SmartFits administrative teams.</p>
        `
        : `
          <p>Hi Smartfits Support Team,</p>

          <p><strong>${employeeName}</strong> is booked off from <strong>${startDate}</strong> to <strong>${endDate}</strong>.</p>

          <p>Please make sure to log this in Smartfits' systems, and make sure not to request them to work during these dates.</p>

          <p>Thank you,<br>
          The SmartCore and SmartFits administrative teams.</p>
        `;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'SmartCore <support@smartcoretechnology.co.uk>',
        to: ['support@smartcoretechnology.co.uk'],
        subject,
        html: emailBody
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      return json({ error: 'Email failed.', details: result }, 500);
    }

    return json({ success: true, result });
  } catch (error) {
    return json({ error: error.message || 'Email failed.' }, 500);
  }
}

function formatDate(value) {
  if (!value) return '';

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(new Date(value));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
