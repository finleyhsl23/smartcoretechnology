// Shared "confirm payment, then email SmartCore" logic for ID card print
// orders. Called from both finalize-card-order.js (the browser's fast-path
// call right after Stripe confirms payment) and stripe-webhook.js's
// payment_intent.succeeded handler (a safety net in case the browser never
// calls back — e.g. the tab closes mid-redirect). Whichever caller wins the
// atomic pending_payment -> paid transition below does the actual emailing;
// the other sees 0 rows updated and exits quietly rather than double-sending.
import { stripeRequest } from './_stripe.js';

const SUPABASE_URL_FALLBACK = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPPORT_EMAIL = 'support@smartcoretechnology.co.uk';
const FROM = 'SmartCore ID Cards <noreply@smartcoretechnology.co.uk>';

function baseUrl(env) { return env.SUPABASE_URL || SUPABASE_URL_FALLBACK; }

async function sbGet(env, path) {
  const r = await fetch(`${baseUrl(env)}/rest/v1${path}`, {
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmt(pence) { return `£${(pence / 100).toFixed(2)}`; }

export async function finalizeCardOrder(env, orderId, { devBypass = false } = {}) {
  const orders = await sbGet(env, `/presence_fire_safety_card_orders?id=eq.${orderId}&select=*&limit=1`);
  const order = orders?.[0];
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.status !== 'pending_payment') return { ok: true, alreadyProcessed: true, status: order.status };

  if (!devBypass) {
    if (!order.stripe_payment_intent_id) return { ok: false, error: 'No payment has been started on this order' };
    const pi = await stripeRequest(env, 'GET', `/payment_intents/${order.stripe_payment_intent_id}`);
    if (pi.status !== 'succeeded') return { ok: false, error: 'Payment has not completed yet' };
  }

  // Atomically claim the order — only succeeds while status is still
  // pending_payment, so a concurrent caller (webhook vs. browser call)
  // can never both win.
  const patchRes = await fetch(`${baseUrl(env)}/rest/v1/presence_fire_safety_card_orders?id=eq.${orderId}&status=eq.pending_payment`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString() }),
  });
  if (!patchRes.ok) throw new Error(await patchRes.text());
  const updated = await patchRes.json();
  if (!updated.length) return { ok: true, alreadyProcessed: true };

  const [companies, employees] = await Promise.all([
    sbGet(env, `/smartcore_core_companies?id=eq.${order.company_id}&select=name&limit=1`),
    sbGet(env, `/core_employees?id=in.(${order.employee_ids.join(',')})&select=id,full_name`),
  ]);
  const companyName = companies?.[0]?.name || 'Unknown company';
  const nameById = Object.fromEntries((employees || []).map((e) => [e.id, e.full_name]));

  const attachments = [];
  for (const empId of order.employee_ids) {
    const safeName = (nameById[empId] || empId).replace(/[^a-z0-9]+/gi, '-');
    for (const face of ['front', 'back']) {
      const imgRes = await fetch(`${baseUrl(env)}/storage/v1/object/presence-fire-safety-card-print-orders/${orderId}/${empId}-${face}.png`, {
        headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
      });
      if (!imgRes.ok) continue; // don't let one missing image sink the whole order/email
      const bytes = await imgRes.arrayBuffer();
      attachments.push({ filename: `${safeName}-${face}.png`, content: arrayBufferToBase64(bytes), content_type: 'image/png' });
    }
  }

  const quantityLabel = `${order.quantity} card${order.quantity === 1 ? '' : 's'}`;
  const html = `
    <h2>New ID card print order</h2>
    <p><strong>${esc(companyName)}</strong> — ${quantityLabel}, ${fmt(order.amount_pence)} paid.</p>
    <h3>Cards for</h3>
    <ul>${order.employee_ids.map((id) => `<li>${esc(nameById[id] || id)}</li>`).join('')}</ul>
    <h3>Ship to</h3>
    <p>
      ${esc(order.shipping_name)}<br>
      ${order.shipping_phone ? `${esc(order.shipping_phone)}<br>` : ''}
      ${esc(order.shipping_address_line1)}<br>
      ${order.shipping_address_line2 ? `${esc(order.shipping_address_line2)}<br>` : ''}
      ${esc(order.shipping_city)}${order.shipping_county ? `, ${esc(order.shipping_county)}` : ''}<br>
      ${esc(order.shipping_postcode)}<br>
      ${esc(order.shipping_country)}
    </p>
    <p style="color:#888;font-size:12px">Order ID: ${orderId}</p>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: SUPPORT_EMAIL,
      subject: `ID Card Print Order — ${companyName} (${quantityLabel})`,
      html,
      attachments,
    }),
  });
  if (!emailRes.ok) throw new Error('Failed to send order email: ' + (await emailRes.text()));

  await fetch(`${baseUrl(env)}/rest/v1/presence_fire_safety_card_orders?id=eq.${orderId}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify({ emailed_at: new Date().toISOString() }),
  });

  return { ok: true };
}
