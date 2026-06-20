/**
 * POST /api/send-cancellation-email
 * Sends a cancellation confirmation email to the customer.
 * Body: { subscription_id: string }
 */

const SUPABASE_URL  = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';
const ADMIN_EMAIL   = 'support@smartcoretechnology.co.uk';
const FROM          = 'SmartCore <noreply@smartcoretechnology.co.uk>';
const SITE          = 'https://smartcoretechnology.co.uk';

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const resendKey = env.RESEND_SMARTCORE_SHOP;
    if (!resendKey) return json({ error: 'Email service not configured' }, 500, cors);

    const { subscription_id } = await request.json();
    if (!subscription_id) return json({ error: 'subscription_id required' }, 400, cors);

    // Fetch subscription
    const subRes = await fetch(
      `${SUPABASE_URL}/rest/v1/marketplace_subscriptions?id=eq.${encodeURIComponent(subscription_id)}&select=*&limit=1`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    const subs = await subRes.json();
    if (!subs?.[0]) return json({ error: 'Subscription not found' }, 404, cors);
    const sub = subs[0];

    // Fetch order
    const orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/marketplace_orders?id=eq.${encodeURIComponent(sub.order_id)}&select=*&limit=1`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    const orders = await orderRes.json();
    if (!orders?.[0]) return json({ error: 'Order not found' }, 404, cors);
    const o = orders[0];

    // Fetch company
    const compRes = await fetch(
      `${SUPABASE_URL}/rest/v1/smartcore_core_companies?order_id=eq.${encodeURIComponent(sub.order_id)}&select=*&limit=1`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    const companies = await compRes.json();
    const company = companies?.[0];
    const companyName = company?.name || o.company_name || 'your company';

    const effectiveDate = fmtDate(sub.cancel_effective_date);

    // Send cancellation email to customer
    await sendEmail(
      resendKey,
      o.email,
      `Subscription cancellation confirmed — ${companyName}`,
      cancellationHtml(o, sub, companyName, effectiveDate)
    );

    // Also notify admin
    await sendEmail(
      resendKey,
      ADMIN_EMAIL,
      `Cancellation scheduled — ${companyName} | ${o.order_reference}`,
      adminCancellationHtml(o, sub, companyName, effectiveDate)
    );

    return json({ success: true }, 200, cors);

  } catch (err) {
    console.error('send-cancellation-email error:', err);
    return json({ error: err.message || 'Internal error' }, 500, cors);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });
}
async function sendEmail(key, to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(t); }
}
function fmt(n) { return `£${(+(n || 0)).toFixed(2)}`; }
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(iso) {
  return new Date(iso || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function emailShell(preheader, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartCore</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#06060e;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#e0e0ea;-webkit-font-smoothing:antialiased}
.wrap{max-width:600px;margin:32px auto;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.08);box-shadow:0 32px 80px rgba(0,0,0,.7)}
.hdr{background:linear-gradient(135deg,#0b0b18 0%,#0f1529 60%,#0c1220 100%);padding:32px 40px;border-bottom:1px solid rgba(255,255,255,.07)}
.logo{display:inline-flex;align-items:center;gap:12px;text-decoration:none}
.logo-mark{width:42px;height:42px;border-radius:12px;overflow:hidden;display:block}
.logo-name{font-size:17px;font-weight:800;color:#f5f5f7;letter-spacing:-.03em}
.logo-tag{font-size:10px;color:rgba(255,255,255,.35);letter-spacing:.08em;text-transform:uppercase;margin-top:1px}
.body{background:#0e0e18;padding:40px}
.tag{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:20px}
.tag-amber{background:rgba(255,159,10,.15);color:#ff9f0a;border:1px solid rgba(255,159,10,.25)}
.tag-blue{background:rgba(91,143,255,.15);color:#5b8fff;border:1px solid rgba(91,143,255,.25)}
h1{font-size:27px;font-weight:800;color:#f5f5f7;letter-spacing:-.04em;line-height:1.2;margin-bottom:10px}
.intro{font-size:15px;color:#8a8a9e;line-height:1.75;margin-bottom:28px}
.ref-box{background:rgba(91,143,255,.1);border:1px solid rgba(91,143,255,.2);border-radius:14px;padding:16px;text-align:center;font-family:ui-monospace,'Courier New',monospace;font-size:22px;font-weight:800;color:#5b8fff;letter-spacing:.07em;margin:0 0 28px}
.section{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:24px;margin:0 0 20px}
.section-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#52526e;margin-bottom:16px}
.kv{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:14px}
.kv:last-child{border-bottom:none}
.kv-k{color:#7a7a96}.kv-v{color:#f5f5f7;font-weight:600}
.cta-btn{display:block;background:linear-gradient(135deg,#5b8fff 0%,#3060d0 100%);color:#fff!important;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:17px 28px;border-radius:14px;letter-spacing:-.01em;margin:20px 0;box-shadow:0 8px 24px rgba(91,143,255,.25)}
.notice-box{background:rgba(255,159,10,.08);border:1px solid rgba(255,159,10,.2);border-radius:14px;padding:20px 24px;margin:0 0 20px}
.notice-box p{font-size:13px;color:#a0a0b4;line-height:1.75}
.notice-box strong{color:#ff9f0a}
.divider{height:1px;background:rgba(255,255,255,.06);margin:24px 0}
.small{font-size:13px;color:#7a7a96;line-height:1.7}
.small a{color:#5b8fff;text-decoration:none}
.ftr{padding:28px 40px;background:#09090f;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#52526e;text-align:center;line-height:2}
.ftr a{color:#5b8fff;text-decoration:none}
</style></head><body>
<div style="display:none;max-height:0;overflow:hidden;font-size:0">${esc(preheader)}</div>
<div class="wrap">
  <div class="hdr">
    <div class="logo">
      <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" class="logo-mark" width="42" height="42" style="border-radius:12px;display:block" />
      <div><div class="logo-name">SmartCore</div><div class="logo-tag">Technology</div></div>
    </div>
  </div>
  <div class="body">${body}</div>
  <div class="ftr">
    SmartCore Technology &bull; <a href="${SITE}">${SITE.replace('https://', '')}</a><br>
    <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a><br>
    <a href="${SITE}/privacy-policy.html">Privacy Policy</a> &bull; <a href="${SITE}/terms">Terms of Service</a>
  </div>
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Customer cancellation email
// ---------------------------------------------------------------------------
function cancellationHtml(o, sub, companyName, effectiveDate) {
  return emailShell(
    `Your ${companyName} SmartCore subscription is scheduled to cancel.`,
    `<span class="tag tag-amber">⚠ Cancellation Scheduled</span>
    <h1>Cancellation Confirmed</h1>
    <p class="intro">We've received your cancellation request for <strong style="color:#f5f5f7">${esc(companyName)}</strong>. Your subscription will remain active until the end of your current billing period.</p>

    <div class="ref-box">${esc(o.order_reference)}</div>

    <div class="section">
      <div class="section-label">Cancellation Details</div>
      <div class="kv"><span class="kv-k">Company</span><span class="kv-v">${esc(companyName)}</span></div>
      <div class="kv"><span class="kv-k">Status</span><span class="kv-v" style="color:#ff9f0a">Cancellation Scheduled</span></div>
      <div class="kv"><span class="kv-k">Access until</span><span class="kv-v">${esc(effectiveDate)}</span></div>
    </div>

    <div class="notice-box">
      <p><strong>What happens next?</strong></p>
      <p>Your SmartCore subscription for ${esc(companyName)} will remain fully active until <strong>${esc(effectiveDate)}</strong>. After this date, access to SmartCore Core and all purchased modules will be revoked.</p>
      <p>All data in your SmartCore system will be retained for 30 days after cancellation, giving you time to export anything you need.</p>
    </div>

    <p style="font-size:14px;color:#8a8a9e;line-height:1.7;margin-bottom:8px">Changed your mind? You can keep your subscription at any time before the cancellation date.</p>
    <a href="${SITE}/cancel-subscriptions" class="cta-btn">Keep My Subscription →</a>

    <div class="divider"></div>
    <p class="small">Questions? Contact us at <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a>.</p>`
  );
}

// ---------------------------------------------------------------------------
// Admin notification email
// ---------------------------------------------------------------------------
function adminCancellationHtml(o, sub, companyName, effectiveDate) {
  return emailShell(
    `Cancellation scheduled: ${companyName}`,
    `<span class="tag tag-amber">⚠ Cancellation Scheduled</span>
    <h1>Cancellation Scheduled</h1>
    <p class="intro">A customer has scheduled their SmartCore subscription for cancellation.</p>

    <div class="section">
      <div class="section-label">Details</div>
      <div class="kv"><span class="kv-k">Company</span><span class="kv-v">${esc(companyName)}</span></div>
      <div class="kv"><span class="kv-k">Order ref</span><span class="kv-v" style="font-family:monospace">${esc(o.order_reference)}</span></div>
      <div class="kv"><span class="kv-k">Customer email</span><span class="kv-v"><a href="mailto:${esc(o.email)}" style="color:#5b8fff">${esc(o.email)}</a></span></div>
      <div class="kv"><span class="kv-k">Effective date</span><span class="kv-v" style="color:#ff9f0a">${esc(effectiveDate)}</span></div>
      <div class="kv"><span class="kv-k">Requested at</span><span class="kv-v">${fmtDate(sub.cancel_requested_at)}</span></div>
    </div>`
  );
}
