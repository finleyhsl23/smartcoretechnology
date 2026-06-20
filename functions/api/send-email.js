/**
 * POST /api/send-email
 *
 * Sends three emails after a confirmed payment:
 *   1. Welcome email  → customer  (access details + getting-started guide)
 *   2. Receipt email  → customer  (full invoice, no-refunds policy, cancel link)
 *   3. Admin notice   → support@  (new company onboarded)
 *
 * Called from payment.html after the Supabase edge function succeeds.
 * Reads RESEND_SMARTCORE_SHOP from Cloudflare environment secrets.
 *
 * Body: { order_id: string }
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
    if (!resendKey) {
      console.error('RESEND_SMARTCORE_SHOP not set in Cloudflare environment');
      return json({ error: 'Email service not configured' }, 500, cors);
    }

    const { order_id } = await request.json();
    if (!order_id) return json({ error: 'order_id required' }, 400, cors);

    // Fetch order (public SELECT policy — anon key is fine)
    const orderRes = await fetch(
      `${SUPABASE_URL}/rest/v1/marketplace_orders?id=eq.${encodeURIComponent(order_id)}&select=*&limit=1`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    const orders = await orderRes.json();
    if (!orders?.[0]) return json({ error: 'Order not found' }, 404, cors);
    const o = orders[0];

    // Only send emails for approved orders
    if (o.status !== 'approved') {
      return json({ skipped: true, reason: 'order not approved' }, 200, cors);
    }

    // Fetch email settings
    let es = {};
    try {
      const esRes = await fetch(
        `${SUPABASE_URL}/rest/v1/marketplace_email_settings?id=eq.1&select=*&limit=1`,
        { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
      );
      const esRows = await esRes.json();
      es = esRows?.[0] || {};
    } catch (_) {}

    const modules = parseModules(o.modules);

    await Promise.all([
      sendEmail(resendKey, o.email,    `Welcome to SmartCore — ${o.order_reference}`,        welcomeHtml(o, modules, es)),
      sendEmail(resendKey, o.email,    `Your SmartCore Receipt — ${o.order_reference}`,       customerReceiptHtml(o, modules, es)),
      sendEmail(resendKey, ADMIN_EMAIL, `New Company Onboarded — ${o.company_name} | ${o.order_reference}`, adminReceiptHtml(o, modules)),
    ]);

    return json({ success: true }, 200, cors);

  } catch (err) {
    console.error('send-email error:', err);
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
function parseModules(m) {
  if (!m) return [];
  if (Array.isArray(m)) return m;
  try { return JSON.parse(m); } catch { return []; }
}
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
function fmt(n) { return '£' + Number(n || 0).toLocaleString('en-GB', {minimumFractionDigits:2, maximumFractionDigits:2}); }
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtDate(iso) {
  return new Date(iso || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Email shell — dark, professional, SmartCore-branded
// ---------------------------------------------------------------------------
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
.tag-green{background:rgba(48,209,88,.15);color:#30d158;border:1px solid rgba(48,209,88,.25)}
.tag-blue{background:rgba(91,143,255,.15);color:#5b8fff;border:1px solid rgba(91,143,255,.25)}
.tag-amber{background:rgba(255,159,10,.15);color:#ff9f0a;border:1px solid rgba(255,159,10,.25)}
h1{font-size:27px;font-weight:800;color:#f5f5f7;letter-spacing:-.04em;line-height:1.2;margin-bottom:10px}
.intro{font-size:15px;color:#8a8a9e;line-height:1.75;margin-bottom:28px}
.ref-box{background:rgba(91,143,255,.1);border:1px solid rgba(91,143,255,.2);border-radius:14px;padding:16px;text-align:center;font-family:ui-monospace,'Courier New',monospace;font-size:22px;font-weight:800;color:#5b8fff;letter-spacing:.07em;margin:0 0 28px}
.section{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:24px;margin:0 0 20px}
.section-label{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#52526e;margin-bottom:16px}
.kv{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:14px}
.kv:last-child{border-bottom:none}
.kv-k{color:#7a7a96}.kv-v{color:#f5f5f7;font-weight:600}
.mod-row{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.mod-row:last-child{border-bottom:none}
.mod-left{display:flex;align-items:center;gap:10px}
.mod-dot{width:7px;height:7px;border-radius:50%;background:#5b8fff;flex-shrink:0}
.mod-dot.green{background:#30d158}
.mod-name{font-size:14px;font-weight:600;color:#f5f5f7}
.mod-link{display:inline-block;font-size:11px;color:#5b8fff;text-decoration:none;background:rgba(91,143,255,.1);border:1px solid rgba(91,143,255,.2);padding:2px 9px;border-radius:6px;margin-left:9px;font-weight:600;vertical-align:middle}
.mod-price{font-size:13px;color:#7a7a96;white-space:nowrap}
.mod-price.free{color:#30d158;font-weight:700}
.disc-row{display:flex;justify-content:space-between;font-size:13px;padding:7px 0;color:#7a7a96}
.disc-val{color:#30d158;font-weight:600}
.total-row{display:flex;justify-content:space-between;font-size:18px;font-weight:800;color:#f5f5f7;padding:16px 0 0;border-top:1px solid rgba(255,255,255,.1);margin-top:10px}
.cta-btn{display:block;background:linear-gradient(135deg,#5b8fff 0%,#3060d0 100%);color:#fff!important;text-decoration:none;text-align:center;font-size:15px;font-weight:700;padding:17px 28px;border-radius:14px;letter-spacing:-.01em;margin:20px 0;box-shadow:0 8px 24px rgba(91,143,255,.25)}
.guide-step{display:flex;gap:14px;margin-bottom:16px}
.guide-step:last-child{margin-bottom:0}
.guide-num{width:26px;height:26px;border-radius:50%;background:rgba(91,143,255,.2);border:1px solid rgba(91,143,255,.3);color:#5b8fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.guide-text{font-size:14px;color:#8a8a9e;line-height:1.7}
.guide-text strong{color:#c0c0d4;display:block;margin-bottom:3px}
.app-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px}
.app-btn{display:inline-flex;align-items:center;gap:9px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:11px;padding:10px 18px;text-decoration:none;color:#f5f5f7!important;font-size:13px;font-weight:600}
.notice-box{background:rgba(255,159,10,.08);border:1px solid rgba(255,159,10,.2);border-radius:14px;padding:20px 24px;margin:0 0 20px}
.notice-box p{font-size:13px;color:#a0a0b4;line-height:1.75}
.notice-box p+p{margin-top:10px}
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
// 1. Welcome email — access details + getting-started guide
// ---------------------------------------------------------------------------
function welcomeHtml(o, modules, es) {
  const regular = modules.filter(m => m.slug !== 'smartcore-core');
  const loginUrl     = es.login_url          || `${SITE}/hq`;
  const privacyUrl   = es.privacy_policy_url || `${SITE}/privacy-policy.html`;
  const termsUrl     = es.terms_url          || `${SITE}/terms`;
  const supportEmail = es.support_email      || 'support@smartcoretechnology.co.uk';
  const appStoreUrl  = es.app_store_url      || '';
  const playUrl      = es.google_play_url    || '';
  const period       = o.billing_type === 'yearly' ? '/yr' : '/mo';

  const modList = [
    `<div class="mod-row"><div class="mod-left"><div class="mod-dot green"></div><span class="mod-name">SmartCore Core</span></div><span class="mod-price free">Included free</span></div>`,
    ...regular.map(m => { const multiplier = o.size_multiplier || 1; const base = o.billing_type === 'yearly' ? (m.yearly_price || m.monthly_price) : m.monthly_price; const price = base * multiplier; return `<div class="mod-row"><div class="mod-left"><div class="mod-dot"></div><span class="mod-name">${esc(m.name)}</span></div><span class="mod-price">${fmt(price)}${period}</span></div>`; }),
  ].join('');

  const appSection = (appStoreUrl || playUrl) ? `
    <div class="section">
      <div class="section-label">Download the SmartCore App</div>
      <p style="font-size:14px;color:#8a8a9e;margin-bottom:14px">Take SmartCore with you on any device. Available on iOS and Android.</p>
      <div class="app-row">
        ${appStoreUrl ? `<a href="${esc(appStoreUrl)}" class="app-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
          App Store
        </a>` : ''}
        ${playUrl ? `<a href="${esc(playUrl)}" class="app-btn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M3.18 23.76c.3.17.64.24.99.2l12.6-7.27-2.79-2.79-10.8 9.86zm16.65-9.63L17.4 12.5l2.43-2.43c.58-.34.95-.97.95-1.65 0-.57-.22-1.1-.6-1.48l-.01-.01c-.4-.38-.93-.59-1.47-.59-.59 0-1.15.23-1.56.65L15.19 9l-2.43-2.44 6.96-4.02c.36-.21.77-.32 1.18-.32.68 0 1.32.29 1.79.79.47.5.71 1.15.69 1.83-.02.7-.3 1.33-.78 1.8l-.02.02-2.75 2.74 2.75 2.74c.48.47.76 1.1.78 1.8.02.68-.22 1.33-.69 1.83-.47.5-1.11.79-1.79.79-.41 0-.82-.11-1.18-.32zM2.69.52C3.1.12 3.7-.07 4.3.02l12.6 7.26-2.79 2.79-11.42-9.55z"/></svg>
          Google Play
        </a>` : ''}
      </div>
    </div>` : '';

  return emailShell(
    `Welcome to SmartCore, ${o.contact_name}! Your workspace is live.`,
    `<span class="tag tag-green">✓ Payment Confirmed</span>
    <h1>Welcome to SmartCore,<br>${esc(o.contact_name)}!</h1>
    <p class="intro">Your payment is confirmed and your SmartCore workspace is live. Here's everything you need to get up and running today. A separate receipt email has also been sent to this address.</p>

    <div class="ref-box">${esc(o.order_reference)}</div>

    <div class="section">
      <div class="section-label">Access Your Workspace</div>
      <p style="font-size:14px;color:#8a8a9e;margin-bottom:16px">Your account is ready to use right now. Click below to log in.</p>
      <a href="${loginUrl}" class="cta-btn">Log in to SmartCore →</a>
    </div>

    <div class="section">
      <div class="section-label">Getting Started Guide</div>
      <div class="guide-step">
        <div class="guide-num">1</div>
        <div class="guide-text"><strong>Sign in to your workspace</strong>Use the button above to open SmartCore. Sign in with the email address on this order. If it's your first time, you may be prompted to set a password.</div>
      </div>
      <div class="guide-step">
        <div class="guide-num">2</div>
        <div class="guide-text"><strong>Explore your dashboard</strong>Your home screen gives you a live overview of your business. All activated modules appear in the left-hand navigation — pre-configured and ready from day one.</div>
      </div>
      <div class="guide-step">
        <div class="guide-num">3</div>
        <div class="guide-text"><strong>Invite your team</strong>Go to <strong>Settings → Team Members</strong> to add colleagues. Assign roles and permissions — your team can be onboarded in minutes.</div>
      </div>
      <div class="guide-step">
        <div class="guide-num">4</div>
        <div class="guide-text"><strong>Expand anytime</strong>Browse the full SmartCore module catalogue at <a href="${SITE}/shop" style="color:#5b8fff">${SITE.replace('https://', '')}/shop</a> and add new modules to your subscription whenever you're ready.</div>
      </div>
    </div>

    <div class="section">
      <div class="section-label">Your Modules</div>
      ${modList}
    </div>

    ${appSection}

    <div class="divider"></div>
    <p class="small">Questions? Email us at <a href="mailto:${supportEmail}">${supportEmail}</a> and we'll get back to you promptly.</p>
    <p class="small" style="margin-top:8px">By using SmartCore you agree to our <a href="${privacyUrl}">Privacy Policy</a> and <a href="${termsUrl}">Terms of Service</a>.</p>`
  );
}

// ---------------------------------------------------------------------------
// 2. Customer receipt — full invoice, no-refunds, cancel info
// ---------------------------------------------------------------------------
function customerReceiptHtml(o, modules, es) {
  const regular      = modules.filter(m => m.slug !== 'smartcore-core');
  const supportEmail = es.support_email || 'support@smartcoretechnology.co.uk';
  const privacyUrl   = es.privacy_policy_url || `${SITE}/privacy-policy.html`;
  const termsUrl     = es.terms_url || `${SITE}/terms`;
  const period       = o.billing_type === 'yearly' ? '/yr' : '/mo';
  const billingLabel = o.billing_type === 'yearly' ? 'Annual' : 'Monthly';
  const date         = fmtDate(o.created_at);

  const modList = [
    `<div class="mod-row"><div class="mod-left"><div class="mod-dot green"></div><span class="mod-name">SmartCore Core</span></div><span class="mod-price free">Included free</span></div>`,
    ...regular.map(m => { const multiplier = o.size_multiplier || 1; const base = o.billing_type === 'yearly' ? (m.yearly_price || m.monthly_price) : m.monthly_price; const price = base * multiplier; return `<div class="mod-row"><div class="mod-left"><div class="mod-dot"></div><span class="mod-name">${esc(m.name)}</span></div><span class="mod-price">${fmt(price)}${period}</span></div>`; }),
  ].join('');

  return emailShell(
    `Your SmartCore receipt for ${o.order_reference} — ${fmt(o.total)}${period}`,
    `<span class="tag tag-blue">🧾 Receipt</span>
    <h1>Your Receipt</h1>
    <p class="intro">Thank you for subscribing to SmartCore. This is your official receipt — please keep it for your records.</p>

    <div class="ref-box">${esc(o.order_reference)}</div>

    <div class="section">
      <div class="section-label">Bill To</div>
      <div class="kv"><span class="kv-k">Company</span><span class="kv-v">${esc(o.company_name)}</span></div>
      <div class="kv"><span class="kv-k">Contact</span><span class="kv-v">${esc(o.contact_name)}</span></div>
      <div class="kv"><span class="kv-k">Email</span><span class="kv-v">${esc(o.email)}</span></div>
      ${o.phone ? `<div class="kv"><span class="kv-k">Phone</span><span class="kv-v">${esc(o.phone)}</span></div>` : ''}
    </div>

    <div class="section">
      <div class="section-label">Order Details</div>
      <div class="kv"><span class="kv-k">Order reference</span><span class="kv-v" style="font-family:monospace">${esc(o.order_reference)}</span></div>
      <div class="kv"><span class="kv-k">Date</span><span class="kv-v">${date}</span></div>
      <div class="kv"><span class="kv-k">Billing cycle</span><span class="kv-v">${billingLabel}</span></div>
      <div class="kv"><span class="kv-k">Status</span><span class="kv-v" style="color:#30d158">✓ Confirmed &amp; Active</span></div>
    </div>

    <div class="section">
      <div class="section-label">Subscription Summary</div>
      ${modList}
      ${(o.discount_amount > 0) ? `<div class="disc-row"><span>Package discount</span><span class="disc-val">−${fmt(o.discount_amount)}</span></div>` : ''}
      ${(o.annual_discount_amount > 0) ? `<div class="disc-row"><span>Annual plan saving</span><span class="disc-val">Saves ${fmt(o.annual_discount_amount)}${period} vs monthly</span></div>` : ''}
      <div class="total-row"><span>Total</span><span>${fmt(o.total)}${period}</span></div>
    </div>

    <div class="notice-box">
      <p><strong>Refund Policy</strong></p>
      <p>All SmartCore subscriptions are non-refundable. By completing your purchase you agreed to our Terms of Service, which state that subscription fees are charged in advance and are not eligible for refund, whether partial or in full, once the billing period has commenced.</p>
      <p>If you believe a charge has been made in error, please contact us at <a href="mailto:${supportEmail}" style="color:#5b8fff">${supportEmail}</a> within 7 days of the charge and we will review your case.</p>
    </div>

    <div class="section">
      <div class="section-label">Managing Your Subscription</div>
      <p style="font-size:14px;color:#8a8a9e;line-height:1.7;margin-bottom:14px">You can add or remove modules, update billing details, or cancel your subscription at any time.</p>
      <a href="${SITE}/cancel-subscriptions" class="cta-btn" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#f5f5f7!important;box-shadow:none">Manage / Cancel Subscription →</a>
      <p style="font-size:12px;color:#52526e;margin-top:10px;text-align:center">Cancellation takes effect at the end of your current billing period.</p>
    </div>

    <div class="section">
      <div class="section-label">Add More Modules</div>
      <p style="font-size:14px;color:#8a8a9e;line-height:1.7;margin-bottom:14px">Discover the full range of SmartCore modules and expand your subscription anytime.</p>
      <a href="${SITE}/shop" class="cta-btn">Browse the SmartCore Shop →</a>
    </div>

    <div class="divider"></div>
    <p class="small">Questions about this receipt or your subscription? Contact us at <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>
    <p class="small" style="margin-top:8px"><a href="${privacyUrl}">Privacy Policy</a> &bull; <a href="${termsUrl}">Terms of Service</a> &bull; <a href="${SITE}/cancel-subscriptions">Cancel Subscription</a></p>`
  );
}

// ---------------------------------------------------------------------------
// 3. Admin notice — sent to SmartCore support team
// ---------------------------------------------------------------------------
function adminReceiptHtml(o, modules) {
  const regular = modules.filter(m => m.slug !== 'smartcore-core');
  const period  = o.billing_type === 'yearly' ? '/yr' : '/mo';

  const modList = [
    `<div class="mod-row"><div class="mod-left"><div class="mod-dot green"></div><span class="mod-name">SmartCore Core</span></div><span class="mod-price free">Included free</span></div>`,
    ...regular.map(m => `<div class="mod-row"><div class="mod-left"><div class="mod-dot"></div><span class="mod-name">${esc(m.name)}<a href="${SITE}/shop" class="mod-link">View in Shop →</a></span></div><span class="mod-price">${fmt(m.price)}${period}</span></div>`),
  ].join('');

  return emailShell(
    `New company onboarded: ${o.company_name} — ${o.order_reference}`,
    `<span class="tag tag-blue">💳 New Company Onboarded</span>
    <h1>New Company Onboarded</h1>
    <p class="intro">A new SmartCore subscription has been placed and automatically approved. SmartCore Core has been provisioned for this company.</p>

    <div class="ref-box">${esc(o.order_reference)}</div>

    <div class="section">
      <div class="section-label">Customer Details</div>
      <div class="kv"><span class="kv-k">Company</span><span class="kv-v">${esc(o.company_name)}</span></div>
      <div class="kv"><span class="kv-k">Contact</span><span class="kv-v">${esc(o.contact_name)}</span></div>
      <div class="kv"><span class="kv-k">Email</span><span class="kv-v"><a href="mailto:${esc(o.email)}" style="color:#5b8fff">${esc(o.email)}</a></span></div>
      ${o.phone ? `<div class="kv"><span class="kv-k">Phone</span><span class="kv-v">${esc(o.phone)}</span></div>` : ''}
      <div class="kv"><span class="kv-k">Staff count</span><span class="kv-v">${esc(o.staff_count || '—')}</span></div>
      <div class="kv"><span class="kv-k">Billing</span><span class="kv-v">${o.billing_type === 'yearly' ? 'Annual' : 'Monthly'}</span></div>
      <div class="kv"><span class="kv-k">Date</span><span class="kv-v">${fmtDate(o.created_at)}</span></div>
    </div>

    <div class="section">
      <div class="section-label">Modules Purchased (${regular.length + 1} total)</div>
      ${modList}
      ${(o.discount_amount > 0) ? `<div class="disc-row"><span>Package discount</span><span class="disc-val">−${fmt(o.discount_amount)}</span></div>` : ''}
      ${(o.annual_discount_amount > 0) ? `<div class="disc-row"><span>Annual plan saving</span><span class="disc-val">${fmt(o.annual_discount_amount)}${period} vs monthly</span></div>` : ''}
      <div class="total-row"><span>Total</span><span>${fmt(o.total)}${period}</span></div>
    </div>

    <a href="${SITE}/hq" class="cta-btn">View in HQ →</a>`
  );
}
