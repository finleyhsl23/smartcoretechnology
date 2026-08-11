// POST /api/presence-fire-safety/create-card-order
// "Send to SmartCore to Print": creates the order row, uploads the
// already-rasterized front/back PNGs for each selected employee (generated
// client-side — see shared/id-card-render.js renderCardImagePair), and
// opens a one-off Stripe PaymentIntent for it. Images are stored now
// (before payment) rather than at finalize time so the print artwork exists
// regardless of whether the browser is still open once payment completes.
import { json, options, getCallerProfile, hasPermission, sbPost, sbPatch } from './_auth.js';
import { stripeRequest } from '../_stripe.js';

export const onRequestOptions = () => options();

const UNIT_PENCE = 400;
const MIN_PENCE = 2000;
const MAX_CARDS_PER_ORDER = 500; // sanity cap — not a documented pricing rule

function bytesFromPngDataUrl(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { employee_images, shipping } = await request.json();
    if (!Array.isArray(employee_images) || !employee_images.length) {
      return json({ error: 'Select at least one employee to print a card for' }, 400);
    }
    if (employee_images.length > MAX_CARDS_PER_ORDER) {
      return json({ error: `Orders are limited to ${MAX_CARDS_PER_ORDER} cards` }, 400);
    }
    for (const e of employee_images) {
      if (!e?.employee_id || !e?.front || !e?.back) {
        return json({ error: 'Each card needs an employee, front image, and back image' }, 400);
      }
    }
    const s = shipping || {};
    if (!s.name || !s.address_line1 || !s.city || !s.postcode) {
      return json({ error: 'Shipping name, address, city, and postcode are required' }, 400);
    }

    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    const allowed = await hasPermission(env, profile.token, profile.company_id, 'presence.manage_badges');
    if (!allowed) return json({ error: 'Forbidden' }, 403);

    const quantity = employee_images.length;
    const amountPence = Math.max(quantity * UNIT_PENCE, MIN_PENCE);

    const orderRows = await sbPost(env, '/presence_fire_safety_card_orders', {
      company_id: profile.company_id,
      created_by: profile.id,
      status: 'pending_payment',
      employee_ids: employee_images.map((e) => e.employee_id),
      quantity,
      unit_price_pence: UNIT_PENCE,
      minimum_order_pence: MIN_PENCE,
      amount_pence: amountPence,
      shipping_name: s.name,
      shipping_phone: s.phone || null,
      shipping_address_line1: s.address_line1,
      shipping_address_line2: s.address_line2 || null,
      shipping_city: s.city,
      shipping_county: s.county || null,
      shipping_postcode: s.postcode,
      shipping_country: s.country || 'United Kingdom',
    });
    const order = orderRows[0];

    for (const e of employee_images) {
      for (const face of ['front', 'back']) {
        const bytes = bytesFromPngDataUrl(e[face]);
        const uploadRes = await fetch(
          `${env.SUPABASE_URL}/storage/v1/object/presence-fire-safety-card-print-orders/${order.id}/${e.employee_id}-${face}.png`,
          {
            method: 'POST',
            headers: {
              apikey: env.SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'Content-Type': 'image/png',
              'x-upsert': 'true',
            },
            body: bytes,
          }
        );
        if (!uploadRes.ok) throw new Error('Card image upload failed: ' + (await uploadRes.text()));
      }
    }

    const pi = await stripeRequest(env, 'POST', '/payment_intents', {
      amount: amountPence,
      currency: 'gbp',
      description: `SmartCore ID card print order — ${quantity} card${quantity === 1 ? '' : 's'}`,
      metadata: { order_type: 'presence_fire_safety_card_order', order_id: order.id, company_id: profile.company_id },
      'automatic_payment_methods[enabled]': 'true',
    });

    await sbPatch(env, `/presence_fire_safety_card_orders?id=eq.${order.id}`, { stripe_payment_intent_id: pi.id });

    return json({
      order_id: order.id,
      client_secret: pi.client_secret,
      publishable_key: env.STRIPE_PUBLISHABLE_KEY,
      amount_pence: amountPence,
    });
  } catch (e) {
    console.error('create-card-order:', e);
    return json({ error: e.message }, 500);
  }
}
