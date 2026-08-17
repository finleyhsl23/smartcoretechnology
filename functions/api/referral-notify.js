/**
 * POST /api/referral-notify
 * Sends a notification email to support when a referral is submitted.
 * Body: { referee_name, referee_email, referee_phone, referee_company, referee_notes,
 *         submitted_by_name, submitted_by_company, submitted_by_email }
 */

const FROM         = 'SmartCore <noreply@smartcoretechnology.co.uk>';
const SUPPORT      = 'support@smartcoretechnology.co.uk';

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const body = await request.json();
    const {
      referee_name, referee_email, referee_phone, referee_company, referee_notes,
      submitted_by_name, submitted_by_company, submitted_by_email,
    } = body;

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0c1333">
        <div style="background:#2563eb;padding:28px 32px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800">New Referral Submitted 🤝</h1>
        </div>
        <div style="background:#f8faff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:28px 32px">
          <h2 style="font-size:15px;font-weight:700;margin:0 0 16px;color:#1e40af">Referred Person</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
            <tr><td style="padding:8px 0;color:#475569;width:140px">Name</td><td style="padding:8px 0;font-weight:600">${esc(referee_name)}</td></tr>
            ${referee_email ? `<tr><td style="padding:8px 0;color:#475569">Email</td><td style="padding:8px 0">${esc(referee_email)}</td></tr>` : ''}
            ${referee_phone ? `<tr><td style="padding:8px 0;color:#475569">Phone</td><td style="padding:8px 0">${esc(referee_phone)}</td></tr>` : ''}
            ${referee_company ? `<tr><td style="padding:8px 0;color:#475569">Company</td><td style="padding:8px 0">${esc(referee_company)}</td></tr>` : ''}
            ${referee_notes ? `<tr><td style="padding:8px 0;color:#475569;vertical-align:top">Notes</td><td style="padding:8px 0">${esc(referee_notes)}</td></tr>` : ''}
          </table>
          <h2 style="font-size:15px;font-weight:700;margin:0 0 16px;color:#1e40af">Submitted By</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:8px 0;color:#475569;width:140px">Name</td><td style="padding:8px 0;font-weight:600">${esc(submitted_by_name)}</td></tr>
            ${submitted_by_company ? `<tr><td style="padding:8px 0;color:#475569">Company</td><td style="padding:8px 0">${esc(submitted_by_company)}</td></tr>` : ''}
            ${submitted_by_email ? `<tr><td style="padding:8px 0;color:#475569">Email</td><td style="padding:8px 0">${esc(submitted_by_email)}</td></tr>` : ''}
          </table>
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #e2e8f0">
            <a href="https://smartcoretechnology.co.uk/hq/" style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:13px;font-weight:700">View in HQ →</a>
          </div>
        </div>
      </div>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.RESEND_SMARTCORE_SHOP}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [SUPPORT],
        subject: `New referral: ${referee_name}${referee_company ? ` (${referee_company})` : ''} — from ${submitted_by_name}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      return new Response(JSON.stringify({ error: err }), { status: 500, headers: cors });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: cors });
}
