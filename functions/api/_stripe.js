/**
 * Stripe API helper — fetch-based, no npm SDK required.
 * Cloudflare Workers / Pages Functions compatible.
 */

const STRIPE_BASE = 'https://api.stripe.com/v1';

/**
 * Make a Stripe API request.
 * Body is automatically form-encoded (Stripe's required format).
 */
export async function stripeRequest(env, method, path, body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': '2023-10-16',
    },
  };

  if (body && method !== 'GET') {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = encodeStripeBody(body);
  }

  const r = await fetch(`${STRIPE_BASE}${path}`, opts);
  const data = await r.json();
  if (!r.ok) {
    throw new Error(data?.error?.message || `Stripe ${method} ${path} → ${r.status}`);
  }
  return data;
}

/**
 * Verify a Stripe webhook signature.
 * Returns the parsed event or throws.
 */
export async function verifyStripeWebhook(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) throw new Error('Missing signature or secret');

  const parts   = Object.fromEntries(signatureHeader.split(',').map(p => p.split('=')));
  const ts      = parts.t;
  const v1      = parts.v1;
  if (!ts || !v1) throw new Error('Invalid Stripe-Signature header');

  const signed  = `${ts}.${rawBody}`;
  const key     = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (computed !== v1) throw new Error('Webhook signature mismatch');

  // Replay protection: reject events older than 5 minutes
  const age = Math.floor(Date.now() / 1000) - parseInt(ts, 10);
  if (age > 300) throw new Error('Webhook timestamp too old');

  return JSON.parse(rawBody);
}

/**
 * Update a Stripe subscription to a new amount.
 * Creates a new Price and swaps the subscription item.
 */
export async function updateStripeSubscription(env, subscriptionId, newTotalGbp, billingType, description) {
  const sub = await stripeRequest(env, 'GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const currentItemId = sub.items?.data?.[0]?.id;
  if (!currentItemId) throw new Error('No subscription item found');

  const interval   = billingType === 'yearly' ? 'year' : 'month';
  const amountPence = Math.round(newTotalGbp * 100);

  const price = await stripeRequest(env, 'POST', '/prices', {
    currency:     'gbp',
    unit_amount:  amountPence,
    recurring:    { interval },
    product_data: { name: description || 'SmartCore Subscription' },
  });

  await stripeRequest(env, 'POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    'items[0][id]':    currentItemId,
    'items[0][price]': price.id,
    proration_behavior: 'none',
  });

  return price.id;
}

// ---------------------------------------------------------------------------
// Stripe uses application/x-www-form-urlencoded with bracket notation
// e.g. { items: [{ price: 'p_xxx' }] } → items[0][price]=p_xxx
// ---------------------------------------------------------------------------
function encodeStripeBody(obj, prefix = '') {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') {
          parts.push(...encodeStripeBody(item, `${key}[${i}]`).split('&').filter(Boolean));
        } else if (item !== null && item !== undefined) {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (v !== null && v !== undefined && typeof v === 'object') {
      parts.push(...encodeStripeBody(v, key).split('&').filter(Boolean));
    } else if (v !== null && v !== undefined) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join('&');
}
