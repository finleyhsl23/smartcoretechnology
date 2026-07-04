/**
 * POST /api/stripe-checkout
 *
 * Creates a Stripe Customer + Subscription for a pending order.
 * Returns { client_secret, publishable_key } so the frontend can
 * mount the Stripe Payment Element and collect card details.
 *
 * Body: { order_id: string }
 * Response: { client_secret, publishable_key, subscription_id }
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_KEY,
 *               STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY
 */

import { stripeRequest } from './_stripe.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type':                 'application/json',
};

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const { order_id } = await request.json();
    if (!order_id) return json({ error: 'order_id required' }, 400, CORS);

    const orders = await dbGet(env, `/marketplace_orders?id=eq.${enc(order_id)}&select=*&limit=1`);
    if (!orders?.[0]) return json({ error: 'Order not found' }, 404, CORS);
    const order = orders[0];

    if (!['pending_payment', 'pending'].includes(order.status)) {
      return json({ error: 'Order is not awaiting payment', status: order.status }, 400, CORS);
    }

    // If we already created a subscription, try to return the existing client_secret
    if (order.stripe_subscription_id) {
      try {
        const existing = await stripeRequest(
          env, 'GET',
          `/subscriptions/${enc(order.stripe_subscription_id)}?expand[]=latest_invoice.payment_intent`,
        );
        if (existing.status === 'incomplete') {
          const cs = existing.latest_invoice?.payment_intent?.client_secret;
          if (cs) {
            return json({
              client_secret:    cs,
              publishable_key:  env.STRIPE_PUBLISHABLE_KEY,
              subscription_id:  existing.id,
            }, 200, CORS);
          }
        }
      } catch (_) { /* fall through to create new */ }
    }

    // Create Stripe Customer if not yet stored
    let customerId = order.stripe_customer_id;
    if (!customerId) {
      const customer = await stripeRequest(env, 'POST', '/customers', {
        email:    order.email,
        name:     order.company_name,
        metadata: { order_id: order.id, order_reference: order.order_reference },
      });
      customerId = customer.id;
    }

    // Create a Price for this order's total
    const amountPence = Math.round((order.total || 0) * 100);
    if (amountPence <= 0) return json({ error: 'Order total must be > 0' }, 400, CORS);

    const interval = order.billing_type === 'yearly' ? 'year' : 'month';
    const price = await stripeRequest(env, 'POST', '/prices', {
      currency:     'gbp',
      unit_amount:  amountPence,
      recurring:    { interval },
      product_data: { name: `SmartCore — ${order.company_name}` },
    });

    // Create a Subscription (payment collected via Payment Element)
    const sub = await stripeRequest(env, 'POST', '/subscriptions', {
      customer:         customerId,
      'items[0][price]': price.id,
      payment_behavior: 'default_incomplete',
      'payment_settings[save_default_payment_method]': 'on_subscription',
      'expand[0]':      'latest_invoice.payment_intent',
      'metadata[order_id]':        order.id,
      'metadata[order_reference]': order.order_reference,
    });

    const clientSecret = sub.latest_invoice?.payment_intent?.client_secret;
    if (!clientSecret) throw new Error('Stripe did not return a client_secret');

    // Persist IDs so we can look them up on webhook / return
    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order_id)}`, {
      stripe_customer_id:     customerId,
      stripe_subscription_id: sub.id,
      stripe_price_id:        price.id,
    });

    return json({
      client_secret:   clientSecret,
      publishable_key: env.STRIPE_PUBLISHABLE_KEY,
      subscription_id: sub.id,
    }, 200, CORS);

  } catch (err) {
    console.error('stripe-checkout:', err);
    return json({ error: err.message || 'Internal error' }, 500, CORS);
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
    method:  'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });
}
