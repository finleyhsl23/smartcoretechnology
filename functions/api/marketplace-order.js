/**
 * POST /api/marketplace-order
 *
 * Called by the checkout page after a successful order insert.
 * Sends:
 *   1. Customer confirmation email (order reference, modules, billing, totals)
 *   2. Internal admin notification email to SmartCore team
 *
 * Body: { order_id }
 * No auth required — order is identified by ID, which is a UUID.
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY in env
 */

const ADMIN_EMAIL = 'orders@smartcoretechnology.co.uk';
const FROM_EMAIL  = 'SmartCore <noreply@smartcoretechnology.co.uk>';
const HQ_URL      = 'https://smartcoretechnology.co.uk/hq';

export async function onRequestPost(context) {
  const { request, env } = context;

  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };

  try {
    const { order_id } = await request.json();
    if (!order_id) return json({ error: 'order_id required' }, 400, cors);

    const order = await getOrder(env, order_id);
    if (!order) return json({ error: 'Order not found' }, 404, cors);

    const modules = Array.isArray(order.modules) ? order.modules : JSON.parse(order.modules || '[]');

    await Promise.all([
      sendEmail(env, {
        to:      order.email,
        subject: `Order Confirmed — ${order.order_reference} | SmartCore`,
        html:    customerEmailHtml(order, modules),
      }),
      sendEmail(env, {
        to:      ADMIN_EMAIL,
        subject: `New Order ${order.order_reference} — ${order.company_name}`,
        html:    adminEmailHtml(order, modules),
      }),
    ]);

    return json({ success: true });
  } catch (err) {
    console.error('marketplace-order email error:', err);
    return json({ error: err.message || 'Internal error' }, 500, cors);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function getOrder(env, id) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/marketplace_orders?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    {
      headers: {
        apikey:        env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );
  if (!res.ok) throw new Error('Failed to fetch order');
  const rows = await res.json();
  return rows?.[0] || null;
}

async function sendEmail(env, { to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('Resend error:', t);
    throw new Error('Email send failed');
  }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

function fmt(n) { return `£${(+n || 0).toFixed(2)}`; }

function billingLabel(type) { return type === 'yearly' ? 'Annual billing (save 8%)' : 'Monthly billing'; }

function moduleRows(modules) {
  return modules.map(m => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#1e293b">${escHtml(m.name)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#64748b;text-align:right">${fmt(m.price)}/mo</td>
    </tr>`).join('');
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function emailShell({ heading, preheader, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#0f172a">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escHtml(preheader)}</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.07)">
  <!-- Header -->
  <tr><td style="background:#020617;padding:24px 32px">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="width:42px;height:42px;border-radius:12px;overflow:hidden;vertical-align:middle">
        <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" width="42" height="42" style="display:block;border-radius:12px" />
      </td>
      <td style="padding-left:12px;color:#fff;font-size:16px;font-weight:700">SmartCore Technology</td>
    </tr></table>
  </td></tr>
  <!-- Body -->
  <tr><td style="padding:32px">${body}</td></tr>
  <!-- Footer -->
  <tr><td style="padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center">
    SmartCore Technology &bull; <a href="https://smartcoretechnology.co.uk" style="color:#3b82f6;text-decoration:none">smartcoretechnology.co.uk</a><br>
    <a href="mailto:support@smartcoretechnology.co.uk" style="color:#3b82f6;text-decoration:none">support@smartcoretechnology.co.uk</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function customerEmailHtml(order, modules) {
  const regularModules = modules.filter(m => m.slug !== 'smartcore-core');
  const date = new Date(order.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });

  const discountRows = [];
  if (order.discount_amount > 0) {
    discountRows.push(`<tr><td style="font-size:13px;color:#64748b;padding:4px 0">Package discount (${Math.round(order.discount_percent * 100)}% off)</td><td style="font-size:13px;color:#22c55e;text-align:right;padding:4px 0">−${fmt(order.discount_amount)}</td></tr>`);
  }
  if (order.annual_discount_amount > 0) {
    discountRows.push(`<tr><td style="font-size:13px;color:#64748b;padding:4px 0">Annual billing discount (8%)</td><td style="font-size:13px;color:#22c55e;text-align:right;padding:4px 0">−${fmt(order.annual_discount_amount)}</td></tr>`);
  }

  const body = `
    <h1 style="font-size:22px;font-weight:800;margin:0 0 6px;color:#0f172a">Order Received!</h1>
    <p style="font-size:15px;color:#475569;margin:0 0 24px">Hi ${escHtml(order.contact_name)}, thank you for your order. Our team will review it and be in touch within 1 working day.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:8px;padding:16px 20px;margin-bottom:24px">
      <tr>
        <td style="font-size:12px;font-weight:700;color:#94a3b8;letter-spacing:.05em;padding-bottom:8px">YOUR ORDER REFERENCE</td>
      </tr>
      <tr>
        <td style="font-family:ui-monospace,Menlo,monospace;font-size:22px;font-weight:800;color:#3b82f6;letter-spacing:.08em">${escHtml(order.order_reference)}</td>
      </tr>
    </table>

    <p style="font-size:13px;font-weight:700;color:#94a3b8;letter-spacing:.05em;margin:0 0 8px">MODULES ORDERED</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:4px">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:700;color:#94a3b8">Module</td>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:13px;font-weight:700;color:#94a3b8;text-align:right">Price/mo</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#1e293b">SmartCore Core</td>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#22c55e;text-align:right">Included free</td>
      </tr>
      ${moduleRows(regularModules)}
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 24px">
      <tr>
        <td style="font-size:14px;color:#64748b;padding:4px 0">${escHtml(billingLabel(order.billing_type))}</td>
        <td style="font-size:14px;color:#64748b;text-align:right;padding:4px 0"></td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#64748b;padding:4px 0">Subtotal</td>
        <td style="font-size:14px;color:#64748b;text-align:right;padding:4px 0">${fmt(order.subtotal)}/mo</td>
      </tr>
      ${discountRows.join('')}
      <tr>
        <td style="font-size:16px;font-weight:800;color:#0f172a;padding:12px 0 4px;border-top:2px solid #e2e8f0">Total</td>
        <td style="font-size:16px;font-weight:800;color:#0f172a;text-align:right;padding:12px 0 4px;border-top:2px solid #e2e8f0">${fmt(order.total)}/mo</td>
      </tr>
    </table>

    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px 16px;margin-bottom:24px;font-size:13px;color:#1d4ed8">
      <strong>Note:</strong> Payment is only arranged after your order has been approved. Nothing has been charged today.
    </div>

    <p style="font-size:14px;font-weight:700;color:#0f172a;margin:0 0 10px">What happens next?</p>
    <ol style="margin:0;padding-left:20px;color:#475569;font-size:14px;line-height:1.8">
      <li>Our team reviews your order — usually within 1 working day.</li>
      <li>We'll contact you at <strong>${escHtml(order.email)}</strong> to confirm details and arrange setup.</li>
      <li>Once approved, your modules are activated and SmartCore Core is provisioned.</li>
      <li>Payment is arranged after approval — nothing is charged until then.</li>
    </ol>

    <p style="font-size:13px;color:#94a3b8;margin:24px 0 0">Order placed on ${date}. Questions? Reply to <a href="mailto:support@smartcoretechnology.co.uk" style="color:#3b82f6">support@smartcoretechnology.co.uk</a></p>
  `;

  return emailShell({
    heading:   `Order Confirmed — ${order.order_reference}`,
    preheader: `Your SmartCore order ${order.order_reference} has been received and is pending review.`,
    body,
  });
}

function adminEmailHtml(order, modules) {
  const regularModules = modules.filter(m => m.slug !== 'smartcore-core');
  const date = new Date(order.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });

  const body = `
    <h1 style="font-size:20px;font-weight:800;margin:0 0 6px;color:#0f172a">New Marketplace Order</h1>
    <p style="font-size:14px;color:#475569;margin:0 0 20px">A new order has been submitted and is pending review.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      <tr><td style="font-size:12px;font-weight:700;color:#94a3b8;padding:4px 0 2px">Order Reference</td></tr>
      <tr><td style="font-family:ui-monospace,Menlo,monospace;font-size:18px;font-weight:800;color:#3b82f6;padding-bottom:16px">${escHtml(order.order_reference)}</td></tr>

      <tr><td colspan="2" style="height:1px;background:#e2e8f0;padding:0;margin:0"></td></tr>

      <tr><td style="font-size:13px;color:#64748b;padding:8px 0 2px;width:160px">Company</td><td style="font-size:14px;font-weight:600;color:#0f172a;padding:8px 0 2px">${escHtml(order.company_name)}</td></tr>
      <tr><td style="font-size:13px;color:#64748b;padding:2px 0">Contact</td><td style="font-size:14px;color:#0f172a;padding:2px 0">${escHtml(order.contact_name)}</td></tr>
      <tr><td style="font-size:13px;color:#64748b;padding:2px 0">Email</td><td style="font-size:14px;padding:2px 0"><a href="mailto:${escHtml(order.email)}" style="color:#3b82f6">${escHtml(order.email)}</a></td></tr>
      ${order.phone ? `<tr><td style="font-size:13px;color:#64748b;padding:2px 0">Phone</td><td style="font-size:14px;color:#0f172a;padding:2px 0">${escHtml(order.phone)}</td></tr>` : ''}
      ${order.staff_count ? `<tr><td style="font-size:13px;color:#64748b;padding:2px 0">Staff count</td><td style="font-size:14px;color:#0f172a;padding:2px 0">${escHtml(String(order.staff_count))}</td></tr>` : ''}
      <tr><td style="font-size:13px;color:#64748b;padding:2px 0">Billing</td><td style="font-size:14px;color:#0f172a;padding:2px 0">${escHtml(billingLabel(order.billing_type))}</td></tr>
      <tr><td style="font-size:13px;color:#64748b;padding:2px 0">Total</td><td style="font-size:15px;font-weight:700;color:#0f172a;padding:2px 0">${fmt(order.total)}/mo</td></tr>
      <tr><td style="font-size:13px;color:#64748b;padding:2px 0">Submitted</td><td style="font-size:13px;color:#64748b;padding:2px 0">${date}</td></tr>
    </table>

    <p style="font-size:13px;font-weight:700;color:#94a3b8;letter-spacing:.05em;margin:0 0 8px">MODULES (${regularModules.length + 1})</p>
    <ul style="margin:0 0 20px;padding-left:20px;color:#334155;font-size:14px;line-height:1.8">
      <li>SmartCore Core <span style="color:#22c55e">(auto-included)</span></li>
      ${regularModules.map(m => `<li>${escHtml(m.name)} — ${fmt(m.price)}/mo</li>`).join('')}
    </ul>

    ${order.notes ? `<div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#713f12"><strong>Customer notes:</strong><br>${escHtml(order.notes)}</div>` : ''}

    <a href="${HQ_URL}#orders" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px">Review in HQ →</a>
  `;

  return emailShell({
    heading:   `New Order ${order.order_reference}`,
    preheader: `${order.company_name} has submitted a new order worth ${fmt(order.total)}/mo — pending review.`,
    body,
  });
}
