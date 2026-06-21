/**
 * Shared PayPal helpers for SmartCore recurring subscriptions.
 *
 * Exports:
 *   getPayPalToken(env)               — OAuth2 client-credentials token
 *   paypalRequest(env, method, path, body) — authenticated PayPal API fetch
 *   cors                              — standard CORS headers object
 *   json(data, status, extra)         — JSON Response helper
 *
 * Required env vars:
 *   PAYPAL_CLIENT_ID
 *   PAYPAL_CLIENT_SECRET
 *   PAYPAL_BASE_URL  (optional, defaults to https://api-m.paypal.com)
 */

export function paypalBase(env) {
  return (env.PAYPAL_BASE_URL || 'https://api-m.paypal.com').replace(/\/$/, '');
}

export async function getPayPalToken(env) {
  const base = paypalBase(env);
  const creds = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error(`PayPal token error: ${await r.text()}`);
  const data = await r.json();
  return data.access_token;
}

export async function paypalRequest(env, method, path, body = null) {
  const base  = paypalBase(env);
  const token = await getPayPalToken(env);
  const opts  = {
    method,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': crypto.randomUUID(),
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${base}${path}`, opts);
  if (!r.ok) throw new Error(`PayPal ${method} ${path}: ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

export const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type':                 'application/json',
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}
