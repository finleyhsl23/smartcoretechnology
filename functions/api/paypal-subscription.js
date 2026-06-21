/**
 * POST /api/paypal-subscription
 *
 * Creates a PayPal recurring subscription for a marketplace order.
 * Called from the checkout page after the customer selects PayPal billing.
 *
 * Body: { order_id: string }
 *
 * Returns: { approval_url: string, subscription_id: string }
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_KEY, PAYPAL_CLIENT_ID,
 *               PAYPAL_CLIENT_SECRET, PAYPAL_BASE_URL (optional)
 */

import { paypalRequest, cors, json } from './_paypal.js';

const SITE = 'https://smartcoretechnology.co.uk';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { order_id } = await request.json();
    if (!order_id) return json({ error: 'order_id required' }, 400, cors);

    // Load order
    const rows = await dbGet(env, `/marketplace_orders?id=eq.${enc(order_id)}&select=*&limit=1`);
    if (!rows?.[0]) return json({ error: 'Order not found' }, 404, cors);
    const o = rows[0];

    // Guard: don't re-create if already confirmed
    if (o.status === 'confirmed') {
      return json({ error: 'Order already confirmed', status: o.status }, 400, cors);
    }

    // Create PayPal Product
    const product = await paypalRequest(env, 'POST', '/v1/catalogs/products', {
      name:        'SmartCore Subscription',
      description: 'SmartCore Technology — SaaS subscription',
      type:        'SERVICE',
      category:    'SOFTWARE',
    });

    // Build billing plan
    const isYearly       = o.billing_type === 'yearly';
    const intervalUnit   = isYearly ? 'YEAR' : 'MONTH';
    const total          = Number(o.total || 0).toFixed(2);

    const plan = await paypalRequest(env, 'POST', '/v1/billing/plans', {
      product_id:   product.id,
      name:         `SmartCore ${isYearly ? 'Annual' : 'Monthly'} — ${o.order_reference}`,
      description:  `Subscription for ${o.company_name}`,
      status:       'ACTIVE',
      billing_cycles: [
        {
          frequency:    { interval_unit: intervalUnit, interval_count: 1 },
          tenure_type:  'REGULAR',
          sequence:     1,
          total_cycles: 0, // 0 = infinite
          pricing_scheme: {
            fixed_price: { value: total, currency_code: 'GBP' },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding:     true,
        setup_fee_failure_action:  'CONTINUE',
        payment_failure_threshold: 1,
      },
    });

    // Create PayPal Subscription
    const subscription = await paypalRequest(env, 'POST', '/v1/billing/subscriptions', {
      plan_id: plan.id,
      subscriber: {
        name: {
          given_name: (o.contact_name || '').split(' ')[0] || o.contact_name || '',
          surname:    (o.contact_name || '').split(' ').slice(1).join(' ') || '',
        },
        email_address: o.email,
      },
      application_context: {
        brand_name:          'SmartCore Technology',
        locale:              'en-GB',
        shipping_preference: 'NO_SHIPPING',
        user_action:         'SUBSCRIBE_NOW',
        return_url: `${SITE}/shop/paypal-return.html?order_id=${enc(order_id)}`,
        cancel_url: `${SITE}/shop/paypal-cancel.html`,
      },
    });

    // Persist plan + subscription IDs
    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order_id)}`, {
      paypal_plan_id:         plan.id,
      paypal_subscription_id: subscription.id,
    });

    // Find approval URL
    const approvalLink = subscription.links?.find(l => l.rel === 'approve');
    if (!approvalLink) throw new Error('No approval URL returned by PayPal');

    return json({
      approval_url:    approvalLink.href,
      subscription_id: subscription.id,
    }, 200, cors);

  } catch (err) {
    console.error('paypal-subscription:', err);
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
