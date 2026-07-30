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
body{background:#06060e;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#e0e0ea}
.wrap{max-width:600px;margin:32px auto;border-radius:20px;overflow:hidden;border:1px solid rgba(255,255,255,.08)}
.hdr{background:linear-gradient(135deg,#0b0b18,#0f1529);padding:28px 36px;border-bottom:1px solid rgba(255,255,255,.07)}
.logo{font-size:18px;font-weight:900;color:#f5f5f7;letter-spacing:-.03em}
.tag{font-size:10px;color:rgba(255,255,255,.35);letter-spacing:.08em;text-transform:uppercase;margin-top:2px}
.body{background:#0e0e18;padding:36px}
.badge{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:rgba(91,143,255,.15);color:#5b8fff;border:1px solid rgba(91,143,255,.25);margin-bottom:20px}
h1{font-size:22px;font-weight:800;color:#f5f5f7;letter-spacing:-.03em;margin-bottom:8px}
.sub{font-size:14px;color:#8a8a9e;line-height:1.7;margin-bottom:28px}
.inv-box{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:20px 24px;margin-bottom:24px}
.row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:13px}
.row:last-child{border-bottom:none;padding-top:12px;font-size:15px;font-weight:700;color:#f5f5f7}
.row span:first-child{color:#7a7a96}
.note{font-size:12px;color:#52526e;line-height:1.7;margin-top:20px}
.ftr{padding:20px 36px;background:#09090f;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#52526e;text-align:center;line-height:2}
.ftr a{color:#5b8fff;text-decoration:none}
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
    <p class="note">The full welcome email and setup instructions have been sent to ${esc(o.email)}.<br>
    For subscription management, visit <a href="${SITE}/cancel-subscriptions" style="color:#5b8fff">${SITE}/cancel-subscriptions</a></p>
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
