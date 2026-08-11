// POST /api/presence-fire-safety/finalize-card-order
// Called right after stripe.confirmPayment() succeeds client-side (fast
// path) — verifies the PaymentIntent server-side before trusting it, then
// emails support@smartcoretechnology.co.uk with the order + card artwork.
// Idempotent: the actual work lives in _card-order-finalize.js, shared with
// stripe-webhook.js's payment_intent.succeeded handler, which acts as a
// safety net if this call never happens (e.g. the browser closes first).
import { json, options, getCallerProfile, hasPermission, sbGet } from './_auth.js';
import { finalizeCardOrder } from './_card-order-finalize.js';

export const onRequestOptions = () => options();

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { order_id, dev_bypass } = await request.json();
    if (!order_id) return json({ error: 'order_id is required' }, 400);

    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    const allowed = await hasPermission(env, profile.token, profile.company_id, 'presence.manage_badges');
    if (!allowed) return json({ error: 'Forbidden' }, 403);

    // Confirm the order belongs to the caller's own company before doing
    // anything else — finalizeCardOrder() itself doesn't take a company_id
    // (the webhook calls it with no user/session context at all).
    const orders = await sbGet(env, `/presence_fire_safety_card_orders?id=eq.${order_id}&company_id=eq.${profile.company_id}&select=id&limit=1`);
    if (!orders?.length) return json({ error: 'Order not found' }, 404);

    const result = await finalizeCardOrder(env, order_id, { devBypass: !!dev_bypass });
    if (!result.ok) return json({ error: result.error || 'Could not confirm this order' }, 400);
    return json(result);
  } catch (e) {
    console.error('finalize-card-order:', e);
    return json({ error: e.message }, 500);
  }
}
