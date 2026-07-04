/**
 * POST /api/stripe-webhook
 *
 * Handles Stripe webhook events.
 *
 * Events handled:
 *   invoice.payment_succeeded  → apply any pending plan change; generate renewal invoice + email
 *   invoice.payment_failed     → log / notify (future: suspend)
 *   customer.subscription.deleted → mark subscription cancelled
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *               STRIPE_WEBHOOK_SECRET, RESEND_API_KEY
 */

import { verifyStripeWebhook } from './_stripe.js';

const ADMIN_EMAIL   = 'support@smartcoretechnology.co.uk';
const FROM_BILLING  = 'SmartCore Billing <noreply@smartcoretechnology.co.uk>';
const SITE          = 'https://smartcoretechnology.co.uk';

const CRM_SLUGS = [
  'smartcore-crm-lite',
  'smartcore-crm-professional',
  'smartcore-crm-business',
  'smartcore-crm-enterprise',
];

export async function onRequestPost(context) {
  const { request, env } = context;

  let event;
  try {
    const rawBody = await request.text();
    const sig     = request.headers.get('stripe-signature') || '';
    event = await verifyStripeWebhook(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('stripe-webhook signature:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 400 });
  }

  try {
    switch (event.type) {
      case 'invoice.payment_succeeded':
        await handleInvoicePaid(env, event.data.object);
        break;
      case 'invoice.payment_failed':
        await handleInvoiceFailed(env, event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(env, event.data.object);
        break;
      default:
        // Acknowledge unhandled events
    }
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error('stripe-webhook handler:', err);
    // Return 200 to prevent Stripe retrying for non-transient errors
    return new Response(JSON.stringify({ error: err.message }), { status: 200 });
  }
}

// ---------------------------------------------------------------------------
// invoice.payment_succeeded
// ---------------------------------------------------------------------------
async function handleInvoicePaid(env, invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  // Find the order by stripe_subscription_id
  const orders = await dbGet(env, `/marketplace_orders?stripe_subscription_id=eq.${enc(subscriptionId)}&select=*&limit=1`);
  if (!orders?.[0]) {
    console.warn('stripe-webhook: no order found for subscription', subscriptionId);
    return;
  }
  let order = orders[0];

  // For the very first invoice (billing_reason = subscription_create), provisioning is
  // handled by the payment-complete Cloudflare Function called from the browser.
  // We only do extra work here for renewals (subscription_cycle) or if order isn't confirmed yet.
  const isInitial = invoice.billing_reason === 'subscription_create';

  // Apply any pending plan change on renewal
  if (!isInitial) {
    const pending = parsePending(order.pending_plan_change);
    if (pending) {
      try {
        order = await applyPendingPlanChange(env, order, pending);
      } catch (e) {
        console.error('stripe-webhook applyPending:', e);
      }
    }

    // Generate renewal invoice email
    try {
      const modules = parseModules(order.modules);
      const today   = new Date().toISOString().slice(0, 10);
      await sendRenewalEmail(env, order, modules, invoice, today);
    } catch (e) {
      console.error('stripe-webhook renewal email:', e);
    }

    // Update next_billing_date
    const nextBilling = order.billing_type === 'yearly' ? addYear(new Date().toISOString().slice(0, 10)) : addMonth(new Date().toISOString().slice(0, 10));
    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, { next_billing_date: nextBilling });
  }
}

// ---------------------------------------------------------------------------
// invoice.payment_failed
// ---------------------------------------------------------------------------
async function handleInvoiceFailed(env, invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const orders = await dbGet(env, `/marketplace_orders?stripe_subscription_id=eq.${enc(subscriptionId)}&select=id,company_name,email,order_reference&limit=1`);
  if (!orders?.[0]) return;
  const order = orders[0];

  console.warn(`stripe-webhook: payment failed for ${order.order_reference} (${order.company_name})`);

  // Send failure email to admin
  try {
    await sendEmail(env, {
      from:    FROM_BILLING,
      to:      ADMIN_EMAIL,
      subject: `Payment Failed — ${order.order_reference} | ${order.company_name}`,
      html:    `<p>Stripe payment failed for <strong>${order.company_name}</strong> (${order.order_reference}).<br>Invoice: ${invoice.id}</p>`,
    });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// customer.subscription.deleted
// ---------------------------------------------------------------------------
async function handleSubscriptionDeleted(env, subscription) {
  const orders = await dbGet(env, `/marketplace_orders?stripe_subscription_id=eq.${enc(subscription.id)}&select=id&limit=1`);
  if (!orders?.[0]) return;

  await dbPatch(env, `/marketplace_orders?id=eq.${enc(orders[0].id)}`, {
    status: 'cancelled',
  });
}

// ---------------------------------------------------------------------------
// Apply pending plan change (same logic as paypal-webhook.js)
// ---------------------------------------------------------------------------
async function applyPendingPlanChange(env, order, pending) {
  const allModules = await dbGet(env, `/marketplace_modules?select=*`);
  const moduleMap  = Object.fromEntries((allModules || []).map(m => [m.slug, m]));

  if (pending.type === 'change_size') {
    const SIZE_TIERS = [
      { id: 'micro',      label: 'Micro',      range: '1–10',        multiplier: 1.00,  maxEmployees: 10   },
      { id: 'small',      label: 'Small',      range: '11–15',       multiplier: 0.71,  maxEmployees: 15   },
      { id: 'growing',    label: 'Growing',    range: '16–50',       multiplier: 1.43,  maxEmployees: 50   },
      { id: 'medium',     label: 'Medium',     range: '51–100',      multiplier: 2.86,  maxEmployees: 100  },
      { id: 'large',      label: 'Large',      range: '101–250',     multiplier: 6.72,  maxEmployees: 250  },
      { id: 'corporate',  label: 'Corporate',  range: '251–500',     multiplier: 14.44, maxEmployees: 500  },
      { id: 'enterprise', label: 'Enterprise', range: '501–999',     multiplier: 28.92, maxEmployees: 999  },
      { id: 'global',     label: 'Global',     range: '1,000–1,500', multiplier: 38.57, maxEmployees: 1500 },
    ];
    const tier      = SIZE_TIERS.find(t => t.id === pending.new_tier_id);
    if (!tier) throw new Error(`Unknown tier: ${pending.new_tier_id}`);
    const modules   = parseModules(order.modules);
    const { subtotal, total } = calcTotal(modules, moduleMap, tier.multiplier, order.billing_type, order.discount_percent || 0);

    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
      size_tier:           tier.id,
      size_multiplier:     tier.multiplier,
      subtotal,
      total,
      pending_plan_change: null,
    });

    const companies = await dbGet(env, `/smartcore_core_companies?order_id=eq.${enc(order.id)}&select=id&limit=1`);
    const company   = companies?.[0];
    if (company?.id) {
      await dbPatch(env, `/smartcore_core_companies?id=eq.${enc(company.id)}`, { employee_limit: tier.maxEmployees });
    }

    return { ...order, size_tier: tier.id, size_multiplier: tier.multiplier, subtotal, total, pending_plan_change: null };

  } else if (pending.type === 'change_crm_tier') {
    const modules    = parseModules(order.modules);
    const newModRows = await dbGet(env, `/marketplace_modules?slug=eq.${enc(pending.new_crm_slug)}&select=*&limit=1`);
    if (!newModRows?.[0]) throw new Error(`CRM module not found: ${pending.new_crm_slug}`);
    const newMod     = newModRows[0];
    const nonCrm     = modules.filter(m => !CRM_SLUGS.includes(m.slug));
    const newModules = [...nonCrm, {
      slug: newMod.slug, name: newMod.name,
      monthly_price: newMod.monthly_price, yearly_price: newMod.yearly_price,
      price: newMod.monthly_price,
    }];
    const multiplier = order.size_multiplier || 1;
    const { subtotal, total } = calcTotal(newModules, moduleMap, multiplier, order.billing_type, order.discount_percent || 0);

    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order.id)}`, {
      modules:             JSON.stringify(newModules),
      subtotal,
      total,
      pending_plan_change: null,
    });

    const companies = await dbGet(env, `/smartcore_core_companies?order_id=eq.${enc(order.id)}&select=id&limit=1`);
    const company   = companies?.[0];
    if (company?.id) {
      for (const slug of CRM_SLUGS) {
        try { await dbDelete(env, `/smartcore_core_purchased_modules?company_id=eq.${enc(company.id)}&module_slug=eq.${enc(slug)}`); } catch (_) {}
      }
      await dbPost(env, '/smartcore_core_purchased_modules', {
        company_id:   company.id,
        order_id:     order.id,
        module_slug:  newMod.slug,
        module_name:  newMod.name,
        billing_type: order.billing_type,
        price:        order.billing_type === 'yearly' ? (newMod.yearly_price || newMod.monthly_price) : newMod.monthly_price,
        status:       'active',
        activated_at: new Date().toISOString(),
      });
    }

    return { ...order, modules: JSON.stringify(newModules), subtotal, total, pending_plan_change: null };
  }

  throw new Error(`Unknown pending change type: ${pending.type}`);
}

// ---------------------------------------------------------------------------
// Renewal invoice email
// ---------------------------------------------------------------------------
async function sendRenewalEmail(env, order, modules, invoice, today) {
  const invoiceNum = await nextInvoiceNumber(env);
  const period     = order.billing_type === 'yearly' ? '/yr' : '/mo';
  const periodEnd  = order.billing_type === 'yearly' ? addYear(today) : addMonth(today);
  const multiplier = order.size_multiplier || 1;
  const regular    = modules.filter(m => m.slug !== 'smartcore-core');

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
    subtotal:             order.subtotal,
    discount_amount:      order.discount_amount || 0,
    total:                order.total,
    billing_period_start: today,
    billing_period_end:   periodEnd,
    due_date:             today,
    status:               'sent',
    stripe_invoice_id:    invoice.id,
  };

  await dbPost(env, '/marketplace_invoices', inv);

  const html     = renewalHtml(inv, order, regular);
  const subject  = `Invoice ${invoiceNum} — ${order.company_name} | SmartCore`;
  const to       = [...new Set([order.email, inv.accounts_email])];
  await Promise.all(to.map(addr => sendEmail(env, { from: FROM_BILLING, to: addr, subject, html })));
}

async function nextInvoiceNumber(env) {
  const year = new Date().getFullYear();
  const rows = await dbGet(env, `/marketplace_invoices?invoice_number=like.INV-${year}-%25&select=invoice_number&order=invoice_number.desc&limit=1`);
  const last = rows?.[0]?.invoice_number;
  const seq  = last ? parseInt(last.split('-')[2] || '0', 10) + 1 : 1;
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}

function renewalHtml(inv, order, regular) {
  const period = order.billing_type === 'yearly' ? '/yr' : '/mo';
  const rows = [
    `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px"><span>SmartCore Core</span><span style="color:#22c55e;font-weight:600">Included free</span></div>`,
    ...regular.map(m => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:14px"><span>${esc(m.name)}</span><span style="font-weight:600">${fmt(m.price || m.monthly_price || 0)}${period}</span></div>`),
  ].join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${inv.invoice_number}</title></head>
<body style="margin:0;padding:32px;background:#f1f5f9;font-family:Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
  <div style="background:#020617;padding:24px 32px;display:flex;align-items:center;gap:12px">
    <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SC" width="36" height="36" style="border-radius:8px" />
    <span style="color:#fff;font-size:16px;font-weight:700">SmartCore Technology</span>
  </div>
  <div style="padding:32px">
    <span style="background:#3b82f6;color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px">Subscription Renewed</span>
    <h1 style="font-size:22px;font-weight:800;margin:16px 0 4px;color:#0f172a">Invoice ${esc(inv.invoice_number)}</h1>
    <p style="color:#64748b;font-size:13px;margin:0 0 24px">${esc(order.company_name)} &bull; ${order.billing_type === 'yearly' ? 'Annual' : 'Monthly'} billing</p>
    ${rows}
    <div style="display:flex;justify-content:space-between;padding:12px 0;font-size:16px;font-weight:800;border-top:2px solid #e2e8f0;margin-top:8px;color:#0f172a">
      <span>Total charged</span><span>${fmt(inv.total)}${period}</span>
    </div>
    <p style="font-size:13px;color:#64748b;margin-top:20px">Payment was collected automatically via Stripe. Questions? <a href="mailto:support@smartcoretechnology.co.uk" style="color:#3b82f6">support@smartcoretechnology.co.uk</a></p>
  </div>
  <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center">
    SmartCore Technology &bull; <a href="${SITE}" style="color:#3b82f6">smartcoretechnology.co.uk</a>
  </div>
</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------
function calcTotal(modules, moduleMap, sizeMultiplier, billingType, discountPct) {
  let subtotal = 0;
  for (const m of modules) {
    if (m.slug === 'smartcore-core') continue;
    const dbMod = moduleMap[m.slug] || m;
    const isCrm = CRM_SLUGS.includes(m.slug);
    const base  = billingType === 'yearly'
      ? (dbMod.yearly_price || dbMod.monthly_price || m.yearly_price || m.monthly_price || 0)
      : (dbMod.monthly_price || m.monthly_price || 0);
    subtotal += isCrm ? base : base * sizeMultiplier;
  }
  const discount = subtotal * (discountPct || 0) / 100;
  return { subtotal, discount, total: Math.max(0, subtotal - discount) };
}

// ---------------------------------------------------------------------------
// DB + email helpers
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
      apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function dbPost(env, path, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function dbDelete(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method: 'DELETE',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, Prefer: 'return=minimal' },
  });
  if (!r.ok) throw new Error(await r.text());
}

async function sendEmail(env, { from, to, subject, html }) {
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

function parsePending(p) {
  if (!p) return null;
  if (typeof p === 'object') return p;
  try { return JSON.parse(p); } catch { return null; }
}

function fmt(n)  { return '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function esc(s)  { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function addMonth(d) {
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()).toISOString().slice(0, 10);
}
function addYear(d) {
  const dt = new Date(d);
  return new Date(dt.getFullYear() + 1, dt.getMonth(), dt.getDate()).toISOString().slice(0, 10);
}
