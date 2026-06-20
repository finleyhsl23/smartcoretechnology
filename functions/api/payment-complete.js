/**
 * POST /api/payment-complete
 *
 * Handles payment result — called from the payment page (test mode)
 * or PayPal webhook (future). No auth required; order_id is a UUID.
 *
 * Body: { order_id: string, result: 'success' | 'failed' }
 *
 * On success → approve order, provision Core, send emails, return redirect URL.
 * On failure → mark payment_failed, return error message.
 *
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
 */

const ADMIN_EMAIL = 'orders@smartcoretechnology.co.uk';
const FROM        = 'SmartCore <noreply@smartcoretechnology.co.uk>';
const SITE        = 'https://smartcoretechnology.co.uk';

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };

  try {
    const { order_id, result } = await request.json();
    if (!order_id || !['success','failed'].includes(result)) {
      return json({ error: 'order_id and result (success|failed) required' }, 400, cors);
    }

    const order = await dbGet(env, `/marketplace_orders?id=eq.${enc(order_id)}&select=*&limit=1`);
    if (!order?.[0]) return json({ error: 'Order not found' }, 404, cors);
    const o = order[0];

    if (!['pending_payment', 'pending'].includes(o.status)) {
      return json({ error: 'Order already processed', status: o.status }, 400, cors);
    }

    if (result === 'failed') {
      await dbPatch(env, `/marketplace_orders?id=eq.${enc(order_id)}`, { status: 'payment_failed' });
      return json({ success: false, message: 'Payment was declined. Please try again or contact support.' }, 200, cors);
    }

    // --- Success path ---
    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order_id)}`, {
      status: 'approved',
      reviewed_at: new Date().toISOString(),
    });

    // Provision SmartCore Core (best-effort — don't fail the payment if this errors)
    try { await provisionCore(env, o); } catch (e) { console.error('provision error:', e); }

    // Send emails (best-effort)
    const modules = parseModules(o.modules);
    try {
      await Promise.all([
        sendEmail(env, { to: o.email,    subject: `Payment Confirmed — ${o.order_reference} | SmartCore`, html: customerHtml(o, modules) }),
        sendEmail(env, { to: ADMIN_EMAIL, subject: `Payment Received — ${o.order_reference} | ${o.company_name}`,  html: adminHtml(o, modules) }),
      ]);
    } catch (e) { console.error('email error:', e); }

    return json({
      success:  true,
      redirect: `/shop/order-confirmed.html?ref=${enc(o.order_reference)}&company=${enc(o.company_name)}`,
    }, 200, cors);

  } catch (err) {
    console.error('payment-complete:', err);
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
// Provisioning
// ---------------------------------------------------------------------------
async function provisionCore(env, o) {
  const existing = await dbGet(env, `/smartcore_core_companies?order_id=eq.${enc(o.id)}&select=id&limit=1`);
  if (existing?.length) return;

  const rows = await dbPost(env, '/smartcore_core_companies', {
    order_id:     o.id,
    company_name: o.company_name,
    company_email: o.email,
    company_phone: o.phone || null,
    staff_count:  o.staff_count || null,
    status:       'active',
    provisioned_at: new Date().toISOString(),
  }, true);

  const company = Array.isArray(rows) ? rows[0] : rows;
  if (!company?.id) return;

  const modules = parseModules(o.modules);
  const all = [
    { slug: 'smartcore-core', name: 'SmartCore Core', price: 0 },
    ...modules.filter(m => m.slug !== 'smartcore-core'),
  ];

  for (const m of all) {
    await dbPost(env, '/smartcore_core_purchased_modules', {
      company_id:   company.id,
      order_id:     o.id,
      module_slug:  m.slug,
      module_name:  m.name,
      billing_type: o.billing_type,
      price:        m.price || 0,
      status:       'active',
      activated_at: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------
function enc(v) { return encodeURIComponent(v); }

async function dbGet(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function dbPatch(env, path, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method: 'PATCH',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function dbPost(env, path, body, returning = false) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: returning ? 'return=representation' : 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  if (returning) return r.json();
}

async function sendEmail(env, { to, subject, html }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!r.ok) throw new Error(await r.text());
}

function parseModules(m) {
  if (!m) return [];
  if (Array.isArray(m)) return m;
  try { return JSON.parse(m); } catch { return []; }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------
function fmt(n) { return `£${(+n || 0).toFixed(2)}`; }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function shell(preheader, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif}
.wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,.08)}
.hdr{background:#020617;padding:24px 32px}
.body{padding:32px}h1{font-size:22px;font-weight:800;margin:0 0 8px;color:#0f172a}
p{font-size:14px;line-height:1.7;color:#334155;margin:0 0 14px}
.btn{display:inline-block;background:#3b82f6;color:#fff!important;text-decoration:none;font-weight:700;font-size:14px;padding:13px 28px;border-radius:10px;margin:8px 0 20px}
.ref{background:#eff6ff;border-radius:10px;padding:16px 20px;margin:16px 0;font-family:ui-monospace,monospace;font-size:22px;font-weight:800;color:#2563eb;letter-spacing:.06em}
.tag{display:inline-block;background:#22c55e;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;margin-bottom:12px}
.row{display:flex;justify-content:space-between;font-size:14px;padding:6px 0;border-bottom:1px solid #f1f5f9}
.total{display:flex;justify-content:space-between;font-size:16px;font-weight:800;padding:10px 0;color:#0f172a;border-top:2px solid #e2e8f0;margin-top:4px}
.ftr{padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center}</style>
</head><body>
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<div class="wrap">
<div class="hdr"><table cellpadding="0" cellspacing="0"><tr>
  <td style="width:42px;height:42px;border-radius:12px;overflow:hidden;vertical-align:middle"><img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" width="42" height="42" style="display:block;border-radius:12px" /></td>
  <td style="padding-left:12px;color:#fff;font-size:15px;font-weight:700">SmartCore Technology</td>
</tr></table></div>
<div class="body">${body}</div>
<div class="ftr">SmartCore Technology &bull; <a href="${SITE}" style="color:#3b82f6">${SITE.replace('https://','')}</a><br><a href="mailto:support@smartcoretechnology.co.uk" style="color:#3b82f6">support@smartcoretechnology.co.uk</a></div>
</div></body></html>`;
}

function customerHtml(o, modules) {
  const regular = modules.filter(m => m.slug !== 'smartcore-core');
  const date = new Date(o.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  const modRows = [
    `<div class="row"><span>SmartCore Core</span><span style="color:#22c55e;font-weight:600">Included free</span></div>`,
    ...regular.map(m => `<div class="row"><span>${esc(m.name)}</span><span style="font-weight:600">${fmt(m.price)}/mo</span></div>`),
  ].join('');
  const discounts = [];
  if (o.discount_amount > 0) discounts.push(`<div class="row"><span style="color:#64748b">Package discount</span><span style="color:#22c55e;font-weight:600">−${fmt(o.discount_amount)}</span></div>`);
  if (o.annual_discount_amount > 0) discounts.push(`<div class="row"><span style="color:#64748b">Annual billing (8%)</span><span style="color:#22c55e;font-weight:600">−${fmt(o.annual_discount_amount)}</span></div>`);

  return shell(
    `Payment confirmed! Your SmartCore order ${o.order_reference} is now active.`,
    `<span class="tag">✓ Payment Confirmed</span>
    <h1>You're all set, ${esc(o.contact_name)}!</h1>
    <p>Your payment has been received and your SmartCore modules are now active. Here's your order summary.</p>
    <div class="ref">${esc(o.order_reference)}</div>
    <p style="font-size:13px;color:#64748b;margin-bottom:16px">Order placed ${date} &bull; ${o.billing_type === 'yearly' ? 'Annual' : 'Monthly'} billing</p>
    ${modRows}
    ${discounts.join('')}
    <div class="total"><span>Total</span><span>${fmt(o.total)}/mo</span></div>
    <br>
    <p>Your SmartCore Core workspace has been provisioned and is ready. We'll be in touch shortly with your login details.</p>
    <p>Questions? Reply to this email or contact <a href="mailto:support@smartcoretechnology.co.uk" style="color:#3b82f6">support@smartcoretechnology.co.uk</a></p>`
  );
}

function adminHtml(o, modules) {
  const regular = modules.filter(m => m.slug !== 'smartcore-core');
  const date = new Date().toLocaleString('en-GB');
  return shell(
    `New payment received from ${o.company_name} — ${o.order_reference}`,
    `<span class="tag">💳 Payment Received</span>
    <h1>New Order — ${esc(o.company_name)}</h1>
    <div class="row"><span>Reference</span><span style="font-family:monospace;font-weight:700;color:#2563eb">${esc(o.order_reference)}</span></div>
    <div class="row"><span>Company</span><span style="font-weight:600">${esc(o.company_name)}</span></div>
    <div class="row"><span>Contact</span><span>${esc(o.contact_name)}</span></div>
    <div class="row"><span>Email</span><span><a href="mailto:${esc(o.email)}" style="color:#3b82f6">${esc(o.email)}</a></span></div>
    ${o.phone ? `<div class="row"><span>Phone</span><span>${esc(o.phone)}</span></div>` : ''}
    <div class="row"><span>Billing</span><span>${o.billing_type === 'yearly' ? 'Annual' : 'Monthly'}</span></div>
    <div class="row"><span>Modules</span><span>${regular.length + 1} (incl. Core)</span></div>
    <div class="total"><span>Total</span><span>${fmt(o.total)}/mo</span></div>
    <br>
    <p>SmartCore Core has been automatically provisioned. Modules: ${['SmartCore Core', ...regular.map(m => m.name)].join(', ')}.</p>
    <p>Processed at ${date}.</p>
    <a href="${SITE}/hq#orders" class="btn">View in HQ →</a>`
  );
}
