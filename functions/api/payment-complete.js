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

const ADMIN_EMAIL    = 'support@smartcoretechnology.co.uk';
const BILLING_EMAIL  = 'support@smartcoretechnology.co.uk';
const FROM           = 'SmartCore <noreply@smartcoretechnology.co.uk>';
const FROM_BILLING   = 'SmartCore Billing <noreply@smartcoretechnology.co.uk>';
const SITE           = 'https://smartcoretechnology.co.uk';

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
    const today = new Date().toISOString().slice(0, 10);
    const nextBilling = o.billing_type === 'yearly' ? addYear(today) : addMonth(today);

    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order_id)}`, {
      status: 'confirmed',
      reviewed_at: new Date().toISOString(),
      subscription_start_date: today,
      next_billing_date: nextBilling,
    });

    // Provision SmartCore Core (best-effort — don't fail the payment if this errors)
    try { await provisionCore(env, o); } catch (e) { console.error('provision error:', e); }

    // Send confirmation + first invoice (best-effort)
    const modules = parseModules(o.modules);
    // Merge billing dates into order object for invoice generation
    const oFull = { ...o, subscription_start_date: today, next_billing_date: nextBilling };
    try {
      await Promise.all([
        sendEmail(env, { from: FROM, to: o.email,    subject: `Payment Confirmed — ${o.order_reference} | SmartCore`, html: customerHtml(oFull, modules) }),
        sendEmail(env, { from: FROM, to: ADMIN_EMAIL, subject: `Payment Received — ${o.order_reference} | ${o.company_name}`,  html: adminHtml(oFull, modules) }),
        sendFirstInvoice(env, oFull, modules, today),
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

async function sendEmail(env, { from = FROM, to, subject, html }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html }),
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
// Date helpers
// ---------------------------------------------------------------------------
function addMonth(d) {
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()).toISOString().slice(0, 10);
}
function addYear(d) {
  const dt = new Date(d);
  return new Date(dt.getFullYear() + 1, dt.getMonth(), dt.getDate()).toISOString().slice(0, 10);
}
function addDays(d, n) {
  const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10);
}
function addWorkingDays(d, n) {
  const dt = new Date(d);
  let added = 0;
  while (added < n) {
    dt.setDate(dt.getDate() + 1);
    const day = dt.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return dt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// First invoice
// ---------------------------------------------------------------------------
async function nextInvoiceNumber(env) {
  const year = new Date().getFullYear();
  const rows = await dbGet(env, `/marketplace_invoices?invoice_number=like.INV-${year}-%25&select=invoice_number&order=invoice_number.desc&limit=1`);
  const last = rows?.[0]?.invoice_number;
  const seq = last ? parseInt(last.split('-')[2] || '0', 10) + 1 : 1;
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}

async function sendFirstInvoice(env, o, modules, today) {
  const invoiceNum   = await nextInvoiceNumber(env);
  const periodEnd    = o.billing_type === 'yearly' ? addYear(today) : addMonth(today);
  const dueDate      = addWorkingDays(today, 3);
  const multiplier   = o.size_multiplier || 1;
  const regular      = modules.filter(m => m.slug !== 'smartcore-core');
  const subtotal     = regular.reduce((s, m) => {
    const base = o.billing_type === 'yearly' ? (m.yearly_price || m.monthly_price) : m.monthly_price;
    return s + (base || 0) * multiplier;
  }, 0);
  const discount     = o.discount_amount || 0;
  const annualDisc   = o.annual_discount_amount || 0;
  const total        = Math.max(0, subtotal - discount - annualDisc);

  const inv = {
    invoice_number:       invoiceNum,
    order_id:             o.id,
    company_name:         o.company_name,
    contact_name:         o.contact_name,
    contact_email:        o.email,
    accounts_email:       o.accounts_email || o.email,
    modules:              modules,
    billing_type:         o.billing_type,
    size_tier:            o.size_tier,
    size_multiplier:      multiplier,
    subtotal,
    discount_amount:      discount,
    total,
    billing_period_start: today,
    billing_period_end:   periodEnd,
    due_date:             dueDate,
    status:               'sent',
  };

  await dbPost(env, '/marketplace_invoices', inv, false);

  const html = invoiceHtml(inv, o, modules);
  const subject = `Invoice ${invoiceNum} — ${o.company_name} | SmartCore`;
  const recipients = [...new Set([o.email, inv.accounts_email, BILLING_EMAIL])];
  await Promise.all(recipients.map(to =>
    sendEmail(env, { from: FROM_BILLING, to, subject, html })
  ));
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------
function fmt(n) {
  return '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

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

function invoiceHtml(inv, o, modules) {
  const regular    = modules.filter(m => m.slug !== 'smartcore-core');
  const period     = o.billing_type === 'yearly' ? '/yr' : '/mo';
  const multiplier = o.size_multiplier || 1;

  const lineRows = [
    `<tr>
      <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0">SmartCore Core</td>
      <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;text-align:center">1</td>
      <td style="padding:12px 16px;font-size:14px;color:#16a34a;font-weight:600;border-bottom:1px solid #e2e8f0;text-align:right">Free</td>
      <td style="padding:12px 16px;font-size:14px;color:#16a34a;font-weight:600;border-bottom:1px solid #e2e8f0;text-align:right">£0.00</td>
    </tr>`,
    ...regular.map((m) => {
      const base  = o.billing_type === 'yearly' ? (m.yearly_price || m.monthly_price) : m.monthly_price;
      const price = (base || 0) * multiplier;
      return `<tr>
        <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0">${esc(m.name)}</td>
        <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;text-align:center">1</td>
        <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;text-align:right">${fmt(price)}</td>
        <td style="padding:12px 16px;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;text-align:right">${fmt(price)}</td>
      </tr>`;
    }),
  ].join('');

  const tierLabel = o.size_tier ? o.size_tier.charAt(0).toUpperCase() + o.size_tier.slice(1) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartCore Invoice ${inv.invoice_number}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)">

  <!-- Blue header -->
  <tr>
    <td style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 60%,#3b82f6 100%);padding:32px 36px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:top">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:14px;vertical-align:middle">
              <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" width="48" height="48" style="display:block;border-radius:12px;border:2px solid rgba(255,255,255,.3)" />
            </td>
            <td style="vertical-align:middle">
              <div style="color:#ffffff;font-size:20px;font-weight:900;letter-spacing:-.02em">SmartCore</div>
              <div style="color:rgba(255,255,255,.75);font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-top:2px">Technology</div>
              <div style="color:rgba(255,255,255,.65);font-size:12px;margin-top:8px;line-height:1.6">
                support@smartcoretechnology.co.uk<br>
                +44 7407 494433<br>
                www.smartcoretechnology.co.uk
              </div>
            </td>
          </tr></table>
        </td>
        <td style="text-align:right;vertical-align:top">
          <div style="color:rgba(255,255,255,.6);font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Invoice</div>
          <div style="color:#ffffff;font-size:36px;font-weight:900;letter-spacing:-.04em;line-height:1">${esc(inv.invoice_number)}</div>
        </td>
      </tr></table>
    </td>
  </tr>

  <!-- Billing details + Invoice meta -->
  <tr>
    <td style="padding:28px 36px 0">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:top;width:50%">
          <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#64748b;margin-bottom:10px">Billed To</div>
          <div style="font-size:16px;font-weight:900;color:#0f172a;text-transform:uppercase;letter-spacing:.02em;margin-bottom:4px">${esc(o.company_name)}</div>
          <div style="font-size:13px;color:#475569;margin-bottom:2px">${esc(o.contact_name)}</div>
          <div style="font-size:13px;color:#475569">${esc(inv.accounts_email || o.email)}</div>
        </td>
        <td style="vertical-align:top;text-align:right">
          <table cellpadding="0" cellspacing="0" style="margin-left:auto">
            <tr>
              <td style="font-size:12px;color:#64748b;padding:4px 0;white-space:nowrap;text-align:right">Invoice No:</td>
              <td style="font-size:12px;font-weight:700;color:#0f172a;padding:4px 0 4px 14px;text-align:right">${esc(inv.invoice_number)}</td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#64748b;padding:4px 0;white-space:nowrap;text-align:right">Invoice Date:</td>
              <td style="font-size:12px;font-weight:700;color:#0f172a;padding:4px 0 4px 14px;text-align:right">${fmtDate(inv.billing_period_start)}</td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#64748b;padding:4px 0;white-space:nowrap;text-align:right">Due Date:</td>
              <td style="font-size:12px;font-weight:700;color:#dc2626;padding:4px 0 4px 14px;text-align:right">${fmtDate(inv.due_date)}</td>
            </tr>
          </table>
        </td>
      </tr></table>
    </td>
  </tr>

  <!-- Total Due box -->
  <tr>
    <td style="padding:20px 36px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e3a8a;border-radius:10px">
        <tr>
          <td style="padding:16px 20px;font-size:13px;font-weight:600;color:rgba(255,255,255,.8)">Total Due</td>
          <td style="padding:16px 20px;text-align:right;font-size:24px;font-weight:900;color:#ffffff">${fmt(inv.total)}${period}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Line items table -->
  <tr>
    <td style="padding:20px 36px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <tr style="background:#1e3a8a">
          <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#ffffff;text-align:left;letter-spacing:.06em;text-transform:uppercase">Description</th>
          <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:.06em;text-transform:uppercase;width:60px">Qty</th>
          <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#ffffff;text-align:right;letter-spacing:.06em;text-transform:uppercase;width:100px">Price</th>
          <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#ffffff;text-align:right;letter-spacing:.06em;text-transform:uppercase;width:100px">Total</th>
        </tr>
        ${lineRows}
      </table>
    </td>
  </tr>

  <!-- Totals -->
  <tr>
    <td style="padding:12px 36px 0">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#64748b" colspan="2">Subtotal</td>
          <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right">${fmt(inv.subtotal)}</td>
        </tr>
        ${inv.discount_amount > 0 ? `<tr>
          <td style="padding:6px 0;font-size:13px;color:#64748b" colspan="2">Package Discount</td>
          <td style="padding:6px 0;font-size:13px;color:#16a34a;font-weight:600;text-align:right">−${fmt(inv.discount_amount)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#64748b" colspan="2">Tax (0%)</td>
          <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right">£0.00</td>
        </tr>
        <tr style="background:#1e3a8a;border-radius:8px">
          <td style="padding:12px 16px;font-size:14px;font-weight:800;color:#ffffff;border-radius:8px 0 0 8px" colspan="2">Total Amount</td>
          <td style="padding:12px 16px;font-size:18px;font-weight:900;color:#ffffff;text-align:right;border-radius:0 8px 8px 0">${fmt(inv.total)}${period}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Payment method -->
  <tr>
    <td style="padding:20px 36px 0">
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px">
        <div style="font-size:12px;font-weight:700;color:#0369a1;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">Payment Method</div>
        <div style="font-size:14px;font-weight:700;color:#0c4a6e;margin-bottom:4px">PayPal</div>
        <div style="font-size:13px;color:#0369a1">Please send payment via PayPal to <strong>support@smartcoretechnology.co.uk</strong> and use your invoice number as the reference.</div>
      </div>
    </td>
  </tr>

  <!-- Terms -->
  <tr>
    <td style="padding:16px 36px 0">
      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:14px 18px">
        <div style="font-size:12px;font-weight:700;color:#92400e;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Terms &amp; Conditions</div>
        <div style="font-size:13px;color:#78350f;line-height:1.6">Payment is due within <strong>3 working calendar days</strong> of this invoice date. Late payments may result in service suspension. For queries, contact <a href="mailto:support@smartcoretechnology.co.uk" style="color:#92400e">support@smartcoretechnology.co.uk</a>.</div>
      </div>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="padding:20px 36px 28px">
      <div style="border-top:1px solid #e2e8f0;padding-top:16px;text-align:center;font-size:12px;color:#94a3b8;line-height:1.8">
        SmartCore Technology &bull; +44 7407 494433 &bull; <a href="https://www.smartcoretechnology.co.uk" style="color:#3b82f6">www.smartcoretechnology.co.uk</a><br>
        Order: ${esc(o.order_reference)} &bull; Period: ${fmtDate(inv.billing_period_start)} – ${fmtDate(inv.billing_period_end)}${tierLabel ? ` &bull; ${tierLabel} tier` : ''}
      </div>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
