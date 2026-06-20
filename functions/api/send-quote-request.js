/**
 * POST /api/send-quote-request
 * Sends a custom-tier quote request to the SmartCore team inbox.
 * Body: { company, contact, email, phone, staff, notes, modules }
 */

const FROM = 'SmartCore Shop <noreply@smartcoretechnology.co.uk>';
const TO   = 'support@smartcoretechnology.co.uk';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const resendKey = env.RESEND_SMARTCORE_SHOP;
    if (!resendKey) return json({ error: 'Email service not configured' }, 500);

    const { company, contact, email, phone, staff, notes, modules } = await request.json();
    if (!company || !contact || !email) return json({ error: 'company, contact and email are required' }, 400);

    const now = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'long', timeStyle: 'short' });

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quote Request</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">
        <tr>
          <td style="background:#0a0a14;padding:28px 36px;border-bottom:1px solid #1e1e2e">
            <table cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-right:14px;vertical-align:middle">
                  <div style="width:42px;height:42px;border-radius:12px;overflow:hidden">
                    <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" width="42" height="42" style="display:block" />
                  </div>
                </td>
                <td style="vertical-align:middle">
                  <div style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-.03em">SmartCore</div>
                  <div style="color:#a1a1a6;font-size:12px">New Quote Request</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 36px">
            <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0a0a14;letter-spacing:-.02em">✦ Custom Enterprise Quote Request</h1>
            <p style="margin:0 0 28px;color:#6b7280;font-size:14px">Received ${now}</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-size:14px">
              <tr style="background:#f9fafb">
                <td style="padding:12px 16px;font-weight:700;color:#374151;width:38%;border-bottom:1px solid #e5e7eb">Company</td>
                <td style="padding:12px 16px;color:#111827;border-bottom:1px solid #e5e7eb">${company}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;font-weight:700;color:#374151;border-bottom:1px solid #e5e7eb">Contact Name</td>
                <td style="padding:12px 16px;color:#111827;border-bottom:1px solid #e5e7eb">${contact}</td>
              </tr>
              <tr style="background:#f9fafb">
                <td style="padding:12px 16px;font-weight:700;color:#374151;border-bottom:1px solid #e5e7eb">Email</td>
                <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb"><a href="mailto:${email}" style="color:#5b8fff;text-decoration:none">${email}</a></td>
              </tr>
              <tr>
                <td style="padding:12px 16px;font-weight:700;color:#374151;border-bottom:1px solid #e5e7eb">Phone</td>
                <td style="padding:12px 16px;color:#111827;border-bottom:1px solid #e5e7eb">${phone || '—'}</td>
              </tr>
              <tr style="background:#f9fafb">
                <td style="padding:12px 16px;font-weight:700;color:#374151;border-bottom:1px solid #e5e7eb">Approx. Staff</td>
                <td style="padding:12px 16px;color:#111827;border-bottom:1px solid #e5e7eb">${staff || '—'}</td>
              </tr>
              <tr>
                <td style="padding:12px 16px;font-weight:700;color:#374151;border-bottom:1px solid #e5e7eb">Modules Interested In</td>
                <td style="padding:12px 16px;color:#111827;border-bottom:1px solid #e5e7eb">${modules || '—'}</td>
              </tr>
              <tr style="background:#f9fafb">
                <td style="padding:12px 16px;font-weight:700;color:#374151;vertical-align:top">Notes</td>
                <td style="padding:12px 16px;color:#111827">${notes ? notes.replace(/\n/g, '<br>') : '—'}</td>
              </tr>
            </table>

            <div style="margin-top:24px;padding:16px 20px;background:#eff6ff;border-radius:10px;border-left:4px solid #5b8fff;font-size:13px;color:#1e40af">
              Reply directly to <strong>${email}</strong> to send your quote.
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 36px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center">
            SmartCore Technology &bull; smartcoretechnology.co.uk
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:     FROM,
        to:       [TO],
        reply_to: email,
        subject:  `Quote Request — ${company} (${staff || '1,500+'} employees)`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return json({ error: 'Email send failed: ' + err }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
