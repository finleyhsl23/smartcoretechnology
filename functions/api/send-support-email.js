/**
 * POST /api/send-support-email
 * Forwards a support form submission to support@smartcoretechnology.co.uk via Resend.
 * Body: { name, email, company, topic, message }
 */

const FROM    = 'SmartCore Support Form <noreply@smartcoretechnology.co.uk>';
const TO      = 'support@smartcoretechnology.co.uk';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { name, email, company, topic, message } = await request.json();
    if (!name || !email || !message) {
      return json({ error: 'name, email, and message are required' }, 400);
    }

    const resendKey = env.RESEND_API_KEY || env.RESEND_SMARTCORE_SHOP;
    if (!resendKey) return json({ error: 'Server not configured' }, 500);

    const subject = `Support: ${topic || 'General enquiry'}${company ? ` — ${company}` : ''}`;

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#1e293b;padding:32px 0}
.wrap{max-width:580px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0}
.hdr{background:#1e3a8a;padding:22px 32px;color:#fff;font-size:16px;font-weight:800}
.body{padding:28px 32px}
.row{padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px;display:flex;gap:12px}
.row:last-child{border-bottom:none}
.row-label{color:#64748b;font-weight:600;width:90px;flex-shrink:0}
.msg{margin-top:16px;background:#f8fafc;border-radius:10px;padding:16px;font-size:14px;line-height:1.7;color:#334155;white-space:pre-wrap}
.ftr{padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center}
</style></head><body>
<div class="wrap">
  <div class="hdr">📬 New Support Enquiry</div>
  <div class="body">
    <div class="row"><span class="row-label">Name</span><span>${esc(name)}</span></div>
    <div class="row"><span class="row-label">Email</span><span><a href="mailto:${esc(email)}" style="color:#2563eb">${esc(email)}</a></span></div>
    <div class="row"><span class="row-label">Company</span><span>${esc(company || '—')}</span></div>
    <div class="row"><span class="row-label">Topic</span><span>${esc(topic || '—')}</span></div>
    <div class="msg">${esc(message)}</div>
  </div>
  <div class="ftr">Sent from smartcoretechnology.co.uk/support</div>
</div>
</body></html>`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:       FROM,
        to:         [TO],
        reply_to:   email,
        subject,
        html,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error('send-support-email Resend error:', t);
      return json({ error: 'Failed to send' }, 500);
    }

    return json({ success: true }, 200);
  } catch (err) {
    console.error('send-support-email error:', err);
    return json({ error: err.message || 'Internal error' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
