/**
 * POST /api/resend-invoice
 * Sends a copy of the welcome/invoice email to the accounts email address.
 * Called from company onboarding after accounts_team_email is saved.
 * Body: { order_id, accounts_email }
 */

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const FROM         = 'SmartCore Billing <noreply@smartcoretechnology.co.uk>';
const SITE         = 'https://smartcoretechnology.co.uk';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { order_id, accounts_email } = await request.json();
    if (!order_id || !accounts_email || !accounts_email.includes('@')) {
      return json({ error: 'order_id and valid accounts_email required' }, 400);
    }

    const serviceKey = env.SUPABASE_SERVICE_ROLE || env.SUPABASE_SERVICE_KEY;
    const resendKey  = env.RESEND_API_KEY || env.RESEND_SMARTCORE_SHOP;
    if (!serviceKey || !resendKey) return json({ error: 'Server not configured' }, 500);

    // Fetch order
    const orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/marketplace_orders?id=eq.${encodeURIComponent(order_id)}&select=*&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const orders = await orderRes.json();
    const o = orders?.[0];
    if (!o) return json({ error: 'Order not found' }, 404);

    // Don't send to the same address as the main email
    if (accounts_email.toLowerCase() === o.email?.toLowerCase()) {
      return json({ skipped: true, reason: 'Same as main email' }, 200);
    }

    // Fetch invoice
    const invRes = await fetch(
      `${SUPABASE_URL}/rest/v1/marketplace_invoices?order_id=eq.${encodeURIComponent(order_id)}&select=*&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const invRows = await invRes.json();
    const inv = invRows?.[0];

    const subject = inv
      ? `Invoice ${inv.invoice_number} — SmartCore (${o.order_reference})`
      : `Your SmartCore receipt — ${o.order_reference}`;

    const html = accountsHtml(o, inv);

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [accounts_email], subject, html }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error('resend-invoice Resend error:', errText);
      return json({ error: 'Failed to send: ' + errText }, 500);
    }

    return json({ success: true }, 200);
  } catch (err) {
    console.error('resend-invoice error:', err);
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

function accountsHtml(o, inv) {
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const invNum = inv?.invoice_number || '—';
  const total  = inv ? `£${Number(inv.total || 0).toFixed(2)}` : '—';
  const billing = o.billing_type === 'yearly' ? 'Annual' : 'Monthly';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>SmartCore Invoice</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#1a1a2e}
.wrap{max-width:600px;margin:32px auto;border-radius:16px;overflow:hidden;border:1px solid #e0e0e8;background:#ffffff}
.hdr{background:#0f1529;padding:24px 36px}
.logo{font-size:18px;font-weight:900;color:#ffffff;letter-spacing:-.03em}
.tag{font-size:10px;color:rgba(255,255,255,.45);letter-spacing:.08em;text-transform:uppercase;margin-top:2px}
.body{background:#ffffff;padding:36px}
.badge{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:#eef2ff;color:#4060e0;border:1px solid #c7d2fe;margin-bottom:20px}
h1{font-size:22px;font-weight:800;color:#0f1529;letter-spacing:-.03em;margin-bottom:8px}
.sub{font-size:14px;color:#555570;line-height:1.7;margin-bottom:28px}
.inv-box{background:#f8f8fc;border:1px solid #e0e0ec;border-radius:12px;padding:20px 24px;margin-bottom:24px}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #ebebf2;font-size:13px;color:#1a1a2e}
.row:last-child{border-bottom:none;padding-top:14px;font-size:15px;font-weight:800;color:#0f1529}
.row span:first-child{color:#777790;font-weight:500}
.note{font-size:12px;color:#888899;line-height:1.8;margin-top:4px}
.note a{color:#4060e0;text-decoration:none}
.ftr{padding:20px 36px;background:#f4f4f7;border-top:1px solid #e0e0e8;font-size:12px;color:#888899;text-align:center;line-height:2}
.ftr a{color:#4060e0;text-decoration:none}
</style></head><body>
<div class="wrap">
  <div class="hdr">
    <div class="logo">SmartCore</div>
    <div class="tag">Technology — Billing</div>
  </div>
  <div class="body">
    <div class="badge">🧾 Invoice Copy</div>
    <h1>Invoice for ${esc(o.company_name)}</h1>
    <p class="sub">This is a copy of the invoice for your SmartCore subscription, sent to your accounts team for your records.</p>
    <div class="inv-box">
      <div class="row"><span>Invoice No.</span><span>${esc(invNum)}</span></div>
      <div class="row"><span>Order Reference</span><span>${esc(o.order_reference)}</span></div>
      <div class="row"><span>Company</span><span>${esc(o.company_name)}</span></div>
      <div class="row"><span>Date</span><span>${date}</span></div>
      <div class="row"><span>Billing</span><span>${billing}</span></div>
      <div class="row"><span>Total</span><span>${total}${o.billing_type === 'yearly' ? '/yr' : '/mo'}</span></div>
    </div>
    <p class="note">The full welcome email and setup instructions have been sent to <a href="mailto:${esc(o.email)}">${esc(o.email)}</a>.<br>
    For subscription management, visit <a href="${SITE}/cancel-subscriptions">${SITE}/cancel-subscriptions</a></p>
  </div>
  <div class="ftr">
    SmartCore Technology &bull; <a href="${SITE}">${SITE.replace('https://','')}</a><br>
    <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a>
  </div>
</div></body></html>`;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
