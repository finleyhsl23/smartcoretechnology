/**
 * Cloudflare scheduled cron — runs daily via wrangler.toml cron trigger.
 * 1. Finds confirmed marketplace orders whose next_billing_date is today or past.
 * 2. Generates a branded invoice, emails it to the accounts team.
 * 3. Records the invoice in marketplace_invoices.
 * 4. Advances next_billing_date by one month or one year.
 * 5. Marks any unpaid invoices past due_date as overdue.
 */

const SUPABASE_URL  = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';
const FROM          = 'SmartCore Billing <noreply@smartcoretechnology.co.uk>';
const SITE          = 'https://smartcoretechnology.co.uk';

// --- Helpers ----------------------------------------------------------------

function fmt(n) {
  return '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function sbFetch(path, method = 'GET', body = null, serviceKey = null) {
  const key = serviceKey || SUPABASE_ANON;
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Supabase ${method} ${path}: ${t}`); }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function sendEmail(resendKey, to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html }),
  });
  if (!r.ok) console.error('Email failed:', await r.text());
}

function addMonth(dateStr) {
  const d = new Date(dateStr);
  const next = new Date(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return next.toISOString().slice(0, 10);
}
function addYear(dateStr) {
  const d = new Date(dateStr);
  return new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function addWorkingDays(dateStr, n) {
  const d = new Date(dateStr);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

// --- Invoice number ---------------------------------------------------------

async function nextInvoiceNumber(serviceKey) {
  const year = new Date().getFullYear();
  const rows = await sbFetch(
    `/rest/v1/marketplace_invoices?invoice_number=like.INV-${year}-%25&select=invoice_number&order=invoice_number.desc&limit=1`,
    'GET', null, serviceKey
  );
  const last = rows?.[0]?.invoice_number;
  const seq = last ? parseInt(last.split('-')[2] || '0', 10) + 1 : 1;
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}

// --- Invoice email HTML -----------------------------------------------------

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
    ...regular.map((m) => {
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
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartCore Invoice ${inv.invoice_number}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 0">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10)">

  <tr>
    <td style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 60%,#3b82f6 100%);padding:32px 36px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:top">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:14px;vertical-align:middle">
              <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" width="48" height="48" style="display:block;border-radius:12px;border:2px solid rgba(255,255,255,.3)" />
            </td>
            <td style="vertical-align:middle">
              <div style="color:#ffffff;font-size:20px;font-weight:900;letter-spacing:-.02em">SmartCore</div>
              <div style="color:rgba(255,255,255,.75);font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-top:2px">Technology</div>
              <div style="color:rgba(255,255,255,.65);font-size:12px;margin-top:8px;line-height:1.6">
                support@smartcoretechnology.co.uk<br>
                +44 7407 494433<br>
                www.smartcoretechnology.co.uk
              </div>
            </td>
          </tr></table>
        </td>
        <td style="text-align:right;vertical-align:top">
          <div style="color:rgba(255,255,255,.6);font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;margin-bottom:6px">Invoice</div>
          <div style="color:#ffffff;font-size:36px;font-weight:900;letter-spacing:-.04em;line-height:1">${esc(inv.invoice_number)}</div>
        </td>
      </tr></table>
    </td>
  </tr>

  <tr>
    <td style="padding:28px 36px 0">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:top;width:50%">
          <div style="font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#64748b;margin-bottom:10px">Billed To</div>
          <div style="font-size:16px;font-weight:900;color:#0f172a;text-transform:uppercase;letter-spacing:.02em;margin-bottom:4px">${esc(o.company_name)}</div>
          <div style="font-size:13px;color:#475569;margin-bottom:2px">${esc(o.contact_name)}</div>
          <div style="font-size:13px;color:#475569">${esc(inv.accounts_email || o.email)}</div>
        </td>
        <td style="vertical-align:top;text-align:right">
          <table cellpadding="0" cellspacing="0" style="margin-left:auto">
            <tr>
              <td style="font-size:12px;color:#64748b;padding:4px 0;white-space:nowrap;text-align:right">Invoice No:</td>
              <td style="font-size:12px;font-weight:700;color:#0f172a;padding:4px 0 4px 14px;text-align:right">${esc(inv.invoice_number)}</td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#64748b;padding:4px 0;white-space:nowrap;text-align:right">Invoice Date:</td>
              <td style="font-size:12px;font-weight:700;color:#0f172a;padding:4px 0 4px 14px;text-align:right">${fmtDate(inv.billing_period_start)}</td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#64748b;padding:4px 0;white-space:nowrap;text-align:right">Due Date:</td>
              <td style="font-size:12px;font-weight:700;color:#dc2626;padding:4px 0 4px 14px;text-align:right">${fmtDate(inv.due_date)}</td>
            </tr>
          </table>
        </td>
      </tr></table>
    </td>
  </tr>

  <tr>
    <td style="padding:20px 36px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#1e3a8a;border-radius:10px">
        <tr>
          <td style="padding:16px 20px;font-size:13px;font-weight:600;color:rgba(255,255,255,.8)">Total Due</td>
          <td style="padding:16px 20px;text-align:right;font-size:24px;font-weight:900;color:#ffffff">${fmt(inv.total)}${period}</td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:20px 36px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
        <tr style="background:#1e3a8a">
          <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#ffffff;text-align:left;letter-spacing:.06em;text-transform:uppercase">Description</th>
          <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#ffffff;text-align:center;letter-spacing:.06em;text-transform:uppercase;width:60px">Qty</th>
          <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#ffffff;text-align:right;letter-spacing:.06em;text-transform:uppercase;width:100px">Price</th>
          <th style="padding:11px 16px;font-size:11px;font-weight:700;color:#ffffff;text-align:right;letter-spacing:.06em;text-transform:uppercase;width:100px">Total</th>
        </tr>
        ${lineRows}
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:12px 36px 0">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#64748b" colspan="2">Subtotal</td>
          <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right">${fmt(inv.subtotal)}</td>
        </tr>
        ${inv.discount_amount > 0 ? `<tr>
          <td style="padding:6px 0;font-size:13px;color:#64748b" colspan="2">Package Discount</td>
          <td style="padding:6px 0;font-size:13px;color:#16a34a;font-weight:600;text-align:right">−${fmt(inv.discount_amount)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#64748b" colspan="2">Tax (0%)</td>
          <td style="padding:6px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right">£0.00</td>
        </tr>
        <tr style="background:#1e3a8a;border-radius:8px">
          <td style="padding:12px 16px;font-size:14px;font-weight:800;color:#ffffff;border-radius:8px 0 0 8px" colspan="2">Total Amount</td>
          <td style="padding:12px 16px;font-size:18px;font-weight:900;color:#ffffff;text-align:right;border-radius:0 8px 8px 0">${fmt(inv.total)}${period}</td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:20px 36px 0">
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px">
        <div style="font-size:12px;font-weight:700;color:#0369a1;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">Payment Method</div>
        <div style="font-size:14px;font-weight:700;color:#0c4a6e;margin-bottom:4px">PayPal</div>
        <div style="font-size:13px;color:#0369a1">Please send payment via PayPal to <strong>support@smartcoretechnology.co.uk</strong> and use your invoice number as the reference.</div>
      </div>
    </td>
  </tr>

  <tr>
    <td style="padding:16px 36px 0">
      <div style="background:#fefce8;border:1px solid #fde68a;border-radius:10px;padding:14px 18px">
        <div style="font-size:12px;font-weight:700;color:#92400e;letter-spacing:.06em;text-transform:uppercase;margin-bottom:6px">Terms &amp; Conditions</div>
        <div style="font-size:13px;color:#78350f;line-height:1.6">Payment is due within <strong>3 working calendar days</strong> of this invoice date. Late payments may result in service suspension. For queries, contact <a href="mailto:support@smartcoretechnology.co.uk" style="color:#92400e">support@smartcoretechnology.co.uk</a>.</div>
      </div>
    </td>
  </tr>

  <tr>
    <td style="padding:20px 36px 28px">
      <div style="border-top:1px solid #e2e8f0;padding-top:16px;text-align:center;font-size:12px;color:#94a3b8;line-height:1.8">
        SmartCore Technology &bull; +44 7407 494433 &bull; <a href="https://www.smartcoretechnology.co.uk" style="color:#3b82f6">www.smartcoretechnology.co.uk</a><br>
        Order: ${esc(o.order_reference)} &bull; Period: ${fmtDate(inv.billing_period_start)} – ${fmtDate(inv.billing_period_end)}${tierLabel ? ` &bull; ${tierLabel} tier` : ''}
      </div>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// --- Main scheduled handler -------------------------------------------------

export async function onScheduled(event, env) {
  const resendKey  = env.RESEND_API_KEY || env.RESEND_SMARTCORE_SHOP;
  const serviceKey = env.SUPABASE_SERVICE_KEY || SUPABASE_ANON;
  const today      = new Date().toISOString().slice(0, 10);

  // 1. Mark overdue invoices
  await sbFetch(
    `/rest/v1/marketplace_invoices?status=eq.sent&due_date=lt.${today}`,
    'PATCH', { status: 'overdue' }, serviceKey
  ).catch(e => console.error('Overdue update failed:', e));

  // 2. Find orders due for billing
  const orders = await sbFetch(
    `/rest/v1/marketplace_orders?status=in.(confirmed,approved)&next_billing_date=lte.${today}&select=*`,
    'GET', null, serviceKey
  ).catch(() => []);

  if (!orders?.length) return;

  for (const o of orders) {
    try {
      const modules = Array.isArray(o.modules) ? o.modules : [];
      const isYearly = o.billing_type === 'yearly';

      // Find the accounts email from companies table
      let accountsEmail = o.email;
      try {
        const companies = await sbFetch(
          `/rest/v1/companies?owner_user_id=eq.${o.auth_user_id}&select=accounts_team_email&limit=1`,
          'GET', null, serviceKey
        );
        if (companies?.[0]?.accounts_team_email) accountsEmail = companies[0].accounts_team_email;
      } catch (_) {}

      const periodStart = o.next_billing_date || today;
      const periodEnd   = isYearly ? addYear(periodStart) : addMonth(periodStart);
      const dueDate     = addWorkingDays(periodStart, 3);
      const invoiceNum  = await nextInvoiceNumber(serviceKey);

      const inv = {
        invoice_number:       invoiceNum,
        order_id:             o.id,
        company_name:         o.company_name,
        contact_name:         o.contact_name,
        contact_email:        o.email,
        accounts_email:       accountsEmail,
        modules,
        billing_type:         o.billing_type,
        size_tier:            o.size_tier,
        size_multiplier:      o.size_multiplier || 1,
        subtotal:             o.subtotal,
        discount_amount:      o.discount_amount || 0,
        total:                o.total,
        billing_period_start: periodStart,
        billing_period_end:   periodEnd,
        due_date:             dueDate,
        status:               'sent',
      };

      // Insert invoice record
      await sbFetch('/rest/v1/marketplace_invoices', 'POST', inv, serviceKey);

      // Send invoice email
      const html = invoiceHtml(inv, o, modules);
      if (resendKey) {
        const recipients = [...new Set([accountsEmail, o.email].filter(Boolean))];
        await sendEmail(resendKey, recipients, `Invoice ${invoiceNum} — ${o.company_name} — ${fmt(o.total)}${isYearly ? '/yr' : '/mo'}`, html);
      }

      // Advance next_billing_date
      const nextDate = isYearly ? addYear(periodStart) : addMonth(periodStart);
      await sbFetch(
        `/rest/v1/marketplace_orders?id=eq.${o.id}`,
        'PATCH', { next_billing_date: nextDate }, serviceKey
      );

      console.log(`Invoice ${invoiceNum} sent for order ${o.order_reference}`);
    } catch (err) {
      console.error(`Invoice failed for order ${o.id}:`, err.message);
    }
  }
}

// Allow manual/worker trigger via GET
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('x-cron-token');
  if (env.CRON_SECRET && token !== env.CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  await onScheduled({}, env);
  return new Response(JSON.stringify({ ok: true, message: 'Invoice cron completed' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
