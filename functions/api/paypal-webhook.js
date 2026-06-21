/**
 * POST /api/paypal-webhook
 *
 * Handles PayPal subscription webhook events. Public endpoint — verified via
 * PayPal webhook signature verification.
 *
 * Handled events:
 *   PAYMENT.SALE.COMPLETED               — recurring charge succeeded
 *   BILLING.SUBSCRIPTION.PAYMENT.FAILED  — charge failed
 *   BILLING.SUBSCRIPTION.CANCELLED       — customer/admin cancelled
 *   BILLING.SUBSCRIPTION.SUSPENDED       — subscription suspended
 *   BILLING.SUBSCRIPTION.ACTIVATED       — subscription activated (backup)
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_KEY, PAYPAL_CLIENT_ID,
 *               PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID, RESEND_API_KEY,
 *               PAYPAL_BASE_URL (optional)
 */

import { paypalRequest, paypalBase, getPayPalToken } from './_paypal.js';

const FROM         = 'SmartCore Billing <noreply@smartcoretechnology.co.uk>';
const FROM_BILLING = 'SmartCore Billing <noreply@smartcoretechnology.co.uk>';
const SITE         = 'https://smartcoretechnology.co.uk';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const bodyText = await request.text();
    let event;
    try { event = JSON.parse(bodyText); } catch { return new Response('Bad JSON', { status: 400 }); }

    // Verify PayPal webhook signature
    const verified = await verifyWebhook(env, request, bodyText, event);
    if (!verified) {
      console.error('PayPal webhook signature verification failed');
      return new Response('Webhook verification failed', { status: 400 });
    }

    const eventType = event.event_type;
    console.log(`PayPal webhook: ${eventType}`);

    switch (eventType) {
      case 'PAYMENT.SALE.COMPLETED':
        await handlePaymentCompleted(env, event);
        break;
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
        await handlePaymentFailed(env, event);
        break;
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        await handleCancelled(env, event);
        break;
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        await handleSuspended(env, event);
        break;
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        await handleActivated(env, event);
        break;
      default:
        // Unknown events — always 200 so PayPal doesn't retry
        console.log(`Unhandled PayPal event: ${eventType}`);
    }

    return new Response('OK', { status: 200 });

  } catch (err) {
    console.error('paypal-webhook error:', err);
    // Return 200 to prevent PayPal retry storms on unexpected errors
    return new Response('OK', { status: 200 });
  }
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------
async function verifyWebhook(env, request, bodyText, parsedBody) {
  // Skip verification if PAYPAL_WEBHOOK_ID not set (dev/test mode)
  if (!env.PAYPAL_WEBHOOK_ID) {
    console.warn('PAYPAL_WEBHOOK_ID not set — skipping webhook verification');
    return true;
  }

  try {
    const base  = paypalBase(env);
    const token = await getPayPalToken(env);

    const verifyBody = {
      auth_algo:         request.headers.get('paypal-auth-algo')       || '',
      cert_url:          request.headers.get('paypal-cert-url')        || '',
      transmission_id:   request.headers.get('paypal-transmission-id') || '',
      transmission_sig:  request.headers.get('paypal-transmission-sig')|| '',
      transmission_time: request.headers.get('paypal-transmission-time')|| '',
      webhook_id:        env.PAYPAL_WEBHOOK_ID,
      webhook_event:     parsedBody,
    };

    const r = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(verifyBody),
    });

    if (!r.ok) {
      console.error('Webhook verify API error:', await r.text());
      return false;
    }

    const data = await r.json();
    return data.verification_status === 'SUCCESS';
  } catch (err) {
    console.error('Webhook verification threw:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handlePaymentCompleted(env, event) {
  const resource       = event.resource || {};
  const subscriptionId = resource.billing_agreement_id || resource.id;
  if (!subscriptionId) return;

  const order = await findOrderBySubscription(env, subscriptionId);
  if (!order) { console.warn(`No order for subscription ${subscriptionId}`); return; }

  const today = new Date().toISOString().slice(0, 10);

  // If order was payment_overdue, restore it
  if (order.status === 'payment_overdue') {
    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
      status:           'confirmed',
      payment_failed_at: null,
      suspended_at:     null,
    });

    // Try to un-suspend smartcore_core_companies if is_suspended column exists
    try {
      await dbPatch(env, `/smartcore_core_companies?order_id=eq.${enc(order.id)}`, {
        status: 'active',
      });
    } catch (_) {}

    // Send service restored email
    try {
      await sendEmail(env, {
        to:      order.email,
        subject: 'Service Restored — SmartCore',
        html:    serviceRestoredHtml(order),
      });
    } catch (e) { console.error('restored email error:', e); }
  }

  // Generate invoice for this billing period
  try {
    const modules    = parseModules(order.modules);
    const periodStart = order.next_billing_date || today;
    const periodEnd   = order.billing_type === 'yearly' ? addYear(periodStart) : addMonth(periodStart);
    const dueDate     = addWorkingDays(periodStart, 3);
    const invoiceNum  = await nextInvoiceNumber(env);
    const multiplier  = order.size_multiplier || 1;
    const regular     = modules.filter(m => m.slug !== 'smartcore-core');
    const subtotal    = regular.reduce((s, m) => {
      const base = order.billing_type === 'yearly' ? (m.yearly_price || m.monthly_price) : m.monthly_price;
      return s + (base || 0) * multiplier;
    }, 0);

    const inv = {
      invoice_number:       invoiceNum,
      order_id:             order.id,
      company_name:         order.company_name,
      contact_name:         order.contact_name,
      contact_email:        order.email,
      accounts_email:       order.accounts_email || order.email,
      modules,
      billing_type:         order.billing_type,
      size_tier:            order.size_tier,
      size_multiplier:      multiplier,
      subtotal,
      discount_amount:      order.discount_amount || 0,
      total:                order.total,
      billing_period_start: periodStart,
      billing_period_end:   periodEnd,
      due_date:             dueDate,
      status:               'sent',
    };

    await dbPost(env, '/marketplace_invoices', inv, false);

    const html    = invoiceHtml(inv, order, modules);
    const subject = `Invoice ${invoiceNum} — ${order.company_name} | SmartCore`;
    const recipients = [...new Set([order.email, inv.accounts_email, 'support@smartcoretechnology.co.uk'])];
    await Promise.all(recipients.map(to => sendEmail(env, { from: FROM_BILLING, to, subject, html })));
  } catch (e) { console.error('invoice error:', e); }

  // Advance next_billing_date
  const newNext = order.billing_type === 'yearly'
    ? addYear(order.next_billing_date || today)
    : addMonth(order.next_billing_date || today);
  await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
    next_billing_date: newNext,
  });
}

async function handlePaymentFailed(env, event) {
  const resource       = event.resource || {};
  const subscriptionId = resource.id || resource.billing_agreement_id;
  if (!subscriptionId) return;

  const order = await findOrderBySubscription(env, subscriptionId);
  if (!order) { console.warn(`No order for subscription ${subscriptionId}`); return; }

  await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
    status:           'payment_overdue',
    payment_failed_at: new Date().toISOString(),
  });

  try {
    await sendEmail(env, {
      to:      order.email,
      subject: 'Payment Failed — Action Required | SmartCore',
      html:    paymentFailedHtml(order),
    });
  } catch (e) { console.error('payment failed email error:', e); }
}

async function handleCancelled(env, event) {
  const resource       = event.resource || {};
  const subscriptionId = resource.id;
  if (!subscriptionId) return;

  const order = await findOrderBySubscription(env, subscriptionId);
  if (!order) { console.warn(`No order for subscription ${subscriptionId}`); return; }

  await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
    status:       'cancelled',
    suspended_at: new Date().toISOString(),
  });

  try {
    await sendEmail(env, {
      to:      order.email,
      subject: 'Subscription Cancelled — SmartCore',
      html:    cancellationHtml(order),
    });
  } catch (e) { console.error('cancellation email error:', e); }
}

async function handleSuspended(env, event) {
  const resource       = event.resource || {};
  const subscriptionId = resource.id;
  if (!subscriptionId) return;

  const order = await findOrderBySubscription(env, subscriptionId);
  if (!order) { console.warn(`No order for subscription ${subscriptionId}`); return; }

  await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
    status:       'suspended',
    suspended_at: new Date().toISOString(),
  });

  try {
    await sendEmail(env, {
      to:      order.email,
      subject: 'Service Suspended — SmartCore',
      html:    suspendedHtml(order),
    });
  } catch (e) { console.error('suspended email error:', e); }
}

async function handleActivated(env, event) {
  const resource       = event.resource || {};
  const subscriptionId = resource.id;
  if (!subscriptionId) return;

  const order = await findOrderBySubscription(env, subscriptionId);
  if (!order) return;

  // Backup: if still pending, mark as confirmed
  if (!['confirmed', 'cancelled', 'suspended'].includes(order.status)) {
    const today      = new Date().toISOString().slice(0, 10);
    const nextBilling = order.billing_type === 'yearly' ? addYear(today) : addMonth(today);
    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
      status:                 'confirmed',
      subscription_start_date: today,
      next_billing_date:      nextBilling,
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
    headers: {
      apikey:         env.SUPABASE_SERVICE_KEY,
      Authorization:  `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function dbPost(env, path, body, returning = false) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method: 'POST',
    headers: {
      apikey:         env.SUPABASE_SERVICE_KEY,
      Authorization:  `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         returning ? 'return=representation' : 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  if (returning) return r.json();
}

async function findOrderBySubscription(env, subscriptionId) {
  const rows = await dbGet(env, `/marketplace_orders?paypal_subscription_id=eq.${enc(subscriptionId)}&select=*&limit=1`);
  return rows?.[0] || null;
}

async function sendEmail(env, { from = FROM, to, subject, html }) {
  const key = env.RESEND_API_KEY || env.RESEND_SMARTCORE_SHOP;
  const r   = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html }),
  });
  if (!r.ok) throw new Error(await r.text());
}

function parseModules(m) {
  if (!m) return [];
  if (Array.isArray(m)) return m;
  try { return JSON.parse(m); } catch { return []; }
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

async function nextInvoiceNumber(env) {
  const year = new Date().getFullYear();
  const rows = await dbGet(env, `/marketplace_invoices?invoice_number=like.INV-${year}-%25&select=invoice_number&order=invoice_number.desc&limit=1`);
  const last = rows?.[0]?.invoice_number;
  const seq  = last ? parseInt(last.split('-')[2] || '0', 10) + 1 : 1;
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------
function fmt(n)    { return '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s)    { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }

function shell(preheader, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif}
.wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,.08)}
.hdr{background:#020617;padding:24px 32px}
.body{padding:32px}h1{font-size:22px;font-weight:800;margin:0 0 8px;color:#0f172a}
p{font-size:14px;line-height:1.7;color:#334155;margin:0 0 14px}
.btn{display:inline-block;background:#3b82f6;color:#fff!important;text-decoration:none;font-weight:700;font-size:14px;padding:13px 28px;border-radius:10px;margin:8px 0 20px}
.btn-red{background:#dc2626}
.ref{background:#eff6ff;border-radius:10px;padding:16px 20px;margin:16px 0;font-family:ui-monospace,monospace;font-size:22px;font-weight:800;color:#2563eb;letter-spacing:.06em}
.tag{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;margin-bottom:12px}
.tag-red{background:#dc2626;color:#fff}
.tag-green{background:#22c55e;color:#fff}
.tag-amber{background:#f59e0b;color:#fff}
.tag-grey{background:#94a3b8;color:#fff}
.row{display:flex;justify-content:space-between;font-size:14px;padding:6px 0;border-bottom:1px solid #f1f5f9}
.warn{background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px 20px;margin:16px 0}
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

function paymentFailedHtml(o) {
  return shell(
    `Action required: Payment failed for your SmartCore subscription — ${o.order_reference}`,
    `<span class="tag tag-red">⚠ Payment Failed</span>
    <h1>Payment Failed — Action Required</h1>
    <p>Hi ${esc(o.contact_name)},</p>
    <p>We were unable to collect your SmartCore subscription payment. Please update your payment method in PayPal to avoid service interruption.</p>
    <div class="ref">${esc(o.order_reference)}</div>
    <div class="warn">
      <p style="color:#b91c1c;font-weight:700;margin:0 0 8px">⚠ Your service will be suspended in 3 days if payment is not received.</p>
      <p style="margin:0;color:#7f1d1d">Amount due: <strong>${fmt(o.total)}/${o.billing_type === 'yearly' ? 'yr' : 'mo'}</strong></p>
    </div>
    <div class="row"><span>Order Reference</span><span style="font-family:monospace;font-weight:700">${esc(o.order_reference)}</span></div>
    <div class="row"><span>Company</span><span>${esc(o.company_name)}</span></div>
    <div class="row"><span>Amount</span><span style="font-weight:700">${fmt(o.total)}/${o.billing_type === 'yearly' ? 'yr' : 'mo'}</span></div>
    <br>
    <p>To update your payment method, log in to your PayPal account and update the payment source for your SmartCore subscription.</p>
    <a href="https://www.paypal.com/myaccount/autopay/" class="btn btn-red">Update Payment in PayPal →</a>
    <p>If you need help or believe this is an error, please contact us immediately at <a href="mailto:support@smartcoretechnology.co.uk" style="color:#3b82f6">support@smartcoretechnology.co.uk</a></p>`
  );
}

function suspendedHtml(o) {
  return shell(
    `Service suspended due to non-payment — ${o.order_reference}`,
    `<span class="tag tag-red">✕ Service Suspended</span>
    <h1>Your SmartCore Service Has Been Suspended</h1>
    <p>Hi ${esc(o.contact_name)},</p>
    <p>Your SmartCore service has been suspended due to non-payment. Access to your workspace and all modules is currently unavailable.</p>
    <div class="ref">${esc(o.order_reference)}</div>
    <div class="row"><span>Company</span><span>${esc(o.company_name)}</span></div>
    <div class="row"><span>Status</span><span style="color:#dc2626;font-weight:700">Suspended</span></div>
    <br>
    <p>To restore your service, please contact us as soon as possible so we can arrange payment and reactivate your account.</p>
    <a href="mailto:support@smartcoretechnology.co.uk?subject=Service%20Restoration%20Request%20—%20${enc(o.order_reference)}" class="btn btn-red">Contact Support to Restore →</a>
    <p>Email: <a href="mailto:support@smartcoretechnology.co.uk" style="color:#3b82f6">support@smartcoretechnology.co.uk</a></p>`
  );
}

function serviceRestoredHtml(o) {
  return shell(
    `Service restored — your SmartCore subscription is active again`,
    `<span class="tag tag-green">✓ Service Restored</span>
    <h1>Your Service Has Been Restored</h1>
    <p>Hi ${esc(o.contact_name)},</p>
    <p>Great news — your payment has been received and your SmartCore service is fully restored. All your modules and data are available again.</p>
    <div class="ref">${esc(o.order_reference)}</div>
    <div class="row"><span>Company</span><span>${esc(o.company_name)}</span></div>
    <div class="row"><span>Status</span><span style="color:#22c55e;font-weight:700">Active</span></div>
    <div class="row"><span>Amount Received</span><span style="font-weight:700">${fmt(o.total)}/${o.billing_type === 'yearly' ? 'yr' : 'mo'}</span></div>
    <br>
    <p>Thank you for resolving the payment. If you have any questions about your account, please don't hesitate to get in touch.</p>
    <a href="${SITE}/hq" class="btn">Log in to SmartCore →</a>`
  );
}

function cancellationHtml(o) {
  return shell(
    `Subscription cancelled — ${o.order_reference}`,
    `<span class="tag tag-grey">Subscription Cancelled</span>
    <h1>Your Subscription Has Been Cancelled</h1>
    <p>Hi ${esc(o.contact_name)},</p>
    <p>Your SmartCore subscription has been cancelled. We're sorry to see you go.</p>
    <div class="ref">${esc(o.order_reference)}</div>
    <div class="row"><span>Company</span><span>${esc(o.company_name)}</span></div>
    <div class="row"><span>Status</span><span style="color:#64748b;font-weight:700">Cancelled</span></div>
    <br>
    <p>Your service will remain accessible until the end of your current billing period. After that, access to your workspace will be removed.</p>
    <p>If you cancelled by mistake or would like to resubscribe, please contact us at <a href="mailto:support@smartcoretechnology.co.uk" style="color:#3b82f6">support@smartcoretechnology.co.uk</a> and we'll be happy to help.</p>
    <a href="${SITE}/shop" class="btn" style="background:#64748b">Resubscribe →</a>`
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
    ...regular.map(m => {
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
<html lang="en"><head><meta charset="utf-8"><title>SmartCore Invoice ${inv.invoice_number}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)">
  <tr><td style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 60%,#3b82f6 100%);padding:32px 36px">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><table cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:14px;vertical-align:middle"><img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" width="48" height="48" style="display:block;border-radius:12px;border:2px solid rgba(255,255,255,.3)" /></td>
        <td style="vertical-align:middle"><div style="color:#fff;font-size:20px;font-weight:900">SmartCore</div><div style="color:rgba(255,255,255,.75);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-top:2px">Technology</div><div style="color:rgba(255,255,255,.65);font-size:12px;margin-top:8px;line-height:1.6">support@smartcoretechnology.co.uk<br>+44 7407 494433<br>www.smartcoretechnology.co.uk</div></td>
      </tr></table></td>
      <td style="text-align:right;vertical-align:top"><div style="color:rgba(255,255,255,.6);font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Invoice</div><div style="color:#fff;font-size:36px;font-weight:900;letter-spacing:-.04em;line-height:1">${esc(inv.invoice_number)}</div></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:28px 36px 0">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:top;width:50%">
        <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#64748b;margin-bottom:10px">Billed To</div>
        <div style="font-size:16px;font-weight:900;color:#0f172a;text-transform:uppercase;margin-bottom:4px">${esc(o.company_name)}</div>
        <div style="font-size:13px;color:#475569;margin-bottom:2px">${esc(o.contact_name)}</div>
        <div style="font-size:13px;color:#475569">${esc(inv.accounts_email || o.email)}</div>
      </td>
      <td style="vertical-align:top;text-align:right">
        <table cellpadding="0" cellspacing="0" style="margin-left:auto">
          <tr><td style="font-size:12px;color:#64748b;padding:4px 0;text-align:right">Invoice No:</td><td style="font-size:12px;font-weight:700;color:#0f172a;padding:4px 0 4px 14px;text-align:right">${esc(inv.invoice_number)}</td></tr>
          <tr><td style="font-size:12px;color:#64748b;padding:4px 0;text-align:right">Invoice Date:</td><td style="font-size:12px;font-weight:700;color:#0f172a;padding:4px 0 4px 14px;text-align:right">${fmtDate(inv.billing_period_start)}</td></tr>
          <tr><td style="font-size:12px;color:#64748b;padding:4px 0;text-align:right">Due Date:</td><td style="font-size:12px;font-weight:700;color:#dc2626;padding:4px 0 4px 14px;text-align:right">${fmtDate(inv.due_date)}</td></tr>
        </table>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:20px 36px 0"><table width="100%" cellpadding="0" cellspacing="0" style="background:#1e3a8a;border-radius:10px"><tr><td style="padding:16px 20px;font-size:13px;font-weight:600;color:rgba(255,255,255,.8)">Total Due</td><td style="padding:16px 20px;text-align:right;font-size:24px;font-weight:900;color:#fff">${fmt(inv.total)}${period}</td></tr></table></td></tr>
  <tr><td style="padding:20px 36px 0"><table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
    <tr style="background:#1e3a8a">
      <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#fff;text-align:left;letter-spacing:.06em;text-transform:uppercase">Description</th>
      <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#fff;text-align:center;width:60px">Qty</th>
      <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#fff;text-align:right;width:100px">Price</th>
      <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#fff;text-align:right;width:100px">Total</th>
    </tr>
    ${lineRows}
  </table></td></tr>
  <tr><td style="padding:12px 36px 0"><table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:6px 0;font-size:13px;color:#64748b" colspan="2">Subtotal</td><td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right">${fmt(inv.subtotal)}</td></tr>
    ${inv.discount_amount > 0 ? `<tr><td style="padding:6px 0;font-size:13px;color:#64748b" colspan="2">Package Discount</td><td style="padding:6px 0;font-size:13px;color:#16a34a;font-weight:600;text-align:right">−${fmt(inv.discount_amount)}</td></tr>` : ''}
    <tr><td style="padding:6px 0;font-size:13px;color:#64748b" colspan="2">Tax (0%)</td><td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right">£0.00</td></tr>
    <tr style="background:#1e3a8a"><td style="padding:12px 16px;font-size:14px;font-weight:800;color:#fff;border-radius:8px 0 0 8px" colspan="2">Total Amount</td><td style="padding:12px 16px;font-size:18px;font-weight:900;color:#fff;text-align:right;border-radius:0 8px 8px 0">${fmt(inv.total)}${period}</td></tr>
  </table></td></tr>
  <tr><td style="padding:20px 36px 28px"><div style="border-top:1px solid #e2e8f0;padding-top:16px;text-align:center;font-size:12px;color:#94a3b8;line-height:1.8">
    SmartCore Technology &bull; +44 7407 494433 &bull; <a href="https://www.smartcoretechnology.co.uk" style="color:#3b82f6">www.smartcoretechnology.co.uk</a><br>
    Order: ${esc(o.order_reference)} &bull; Period: ${fmtDate(inv.billing_period_start)} – ${fmtDate(inv.billing_period_end)}${tierLabel ? ` &bull; ${tierLabel} tier` : ''}
  </div></td></tr>
</table></td></tr></table>
</body></html>`;
}
