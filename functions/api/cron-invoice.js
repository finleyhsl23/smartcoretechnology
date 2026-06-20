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
  const regular   = modules.filter(m => m.slug !== 'smartcore-core');
  const period    = o.billing_type === 'yearly' ? '/yr' : '/mo';
  const multiplier = o.size_multiplier || 1;

  const lineRows = [
    `<tr style="background:#f9fafb">
       <td style="padding:10px 16px;font-size:14px;color:#111827">SmartCore Core</td>
       <td style="padding:10px 16px;font-size:14px;color:#111827;text-align:right">Included free</td>
     </tr>`,
    ...regular.map((m, i) => {
      const base  = o.billing_type === 'yearly' ? (m.yearly_price || m.monthly_price) : m.monthly_price;
      const price = base * multiplier;
      return `<tr${i % 2 === 0 ? '' : ' style="background:#f9fafb"'}>
        <td style="padding:10px 16px;font-size:14px;color:#111827;border-top:1px solid #e5e7eb">${esc(m.name)}</td>
        <td style="padding:10px 16px;font-size:14px;color:#111827;border-top:1px solid #e5e7eb;text-align:right">${fmt(price)}${period}</td>
      </tr>`;
    }),
  ].join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartCore Invoice ${inv.invoice_number}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Inter,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">

  <!-- Header -->
  <tr>
    <td style="background:#080810;padding:28px 36px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:12px;vertical-align:middle">
              <div style="width:40px;height:40px;border-radius:10px;overflow:hidden">
                <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" width="40" height="40" style="display:block" />
              </div>
            </td>
            <td style="vertical-align:middle">
              <div style="color:#fff;font-size:18px;font-weight:800;letter-spacing:-.03em">SmartCore</div>
              <div style="color:#a1a1a6;font-size:11px;letter-spacing:.06em;text-transform:uppercase">Technology</div>
            </td>
          </tr></table>
        </td>
        <td style="text-align:right;vertical-align:middle">
          <div style="color:#a78bfa;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">Invoice</div>
          <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-.02em">${inv.invoice_number}</div>
        </td>
      </tr></table>
    </td>
  </tr>

  <!-- Meta bar -->
  <tr>
    <td style="background:#0f0f1a;padding:16px 36px;border-bottom:1px solid rgba(255,255,255,.08)">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:12px;color:#a1a1a6"><strong style="color:#f5f5f7">Invoice date:</strong> ${fmtDate(inv.billing_period_start)}</td>
        <td style="font-size:12px;color:#a1a1a6;text-align:center"><strong style="color:#f5f5f7">Due date:</strong> ${fmtDate(inv.due_date)}</td>
        <td style="font-size:12px;color:#a1a1a6;text-align:right"><strong style="color:#f5f5f7">Period:</strong> ${fmtDate(inv.billing_period_start)} – ${fmtDate(inv.billing_period_end)}</td>
      </tr></table>
    </td>
  </tr>

  <!-- Bill to / from -->
  <tr>
    <td style="padding:28px 36px 0">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:top;width:50%">
          <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;margin-bottom:8px">Bill To</div>
          <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px">${esc(o.company_name)}</div>
          <div style="font-size:13px;color:#4b5563">${esc(o.contact_name)}</div>
          <div style="font-size:13px;color:#4b5563">${esc(inv.accounts_email || o.email)}</div>
        </td>
        <td style="vertical-align:top;text-align:right">
          <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;margin-bottom:8px">From</div>
          <div style="font-size:15px;font-weight:700;color:#111827">SmartCore Technology</div>
          <div style="font-size:13px;color:#4b5563">support@smartcoretechnology.co.uk</div>
          <div style="font-size:13px;color:#4b5563">smartcoretechnology.co.uk</div>
        </td>
      </tr></table>
    </td>
  </tr>

  <!-- Line items -->
  <tr>
    <td style="padding:24px 36px 0">
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
        <tr style="background:#111827">
          <th style="padding:10px 16px;font-size:11px;font-weight:700;color:#f9fafb;text-align:left;letter-spacing:.05em;text-transform:uppercase">Module</th>
          <th style="padding:10px 16px;font-size:11px;font-weight:700;color:#f9fafb;text-align:right;letter-spacing:.05em;text-transform:uppercase">Price</th>
        </tr>
        ${lineRows}
      </table>
    </td>
  </tr>

  <!-- Totals -->
  <tr>
    <td style="padding:0 36px 28px">
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">
        ${inv.discount_amount > 0 ? `<tr><td style="padding:6px 0;font-size:13px;color:#4b5563">Package discount</td><td style="padding:6px 0;font-size:13px;color:#059669;text-align:right">−${fmt(inv.discount_amount)}</td></tr>` : ''}
        <tr style="border-top:2px solid #111827">
          <td style="padding:12px 0 4px;font-size:17px;font-weight:800;color:#111827">Total Due</td>
          <td style="padding:12px 0 4px;font-size:22px;font-weight:800;color:#111827;text-align:right">${fmt(inv.total)}${period}</td>
        </tr>
        <tr>
          <td colspan="2" style="font-size:12px;color:#9ca3af;padding-bottom:8px">${o.billing_type === 'yearly' ? 'Annual subscription' : 'Monthly subscription'} · ${o.size_tier ? o.size_tier.charAt(0).toUpperCase() + o.size_tier.slice(1) : ''} tier (×${multiplier})</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Payment info -->
  <tr>
    <td style="padding:0 36px 28px">
      <div style="background:#eff6ff;border-radius:12px;padding:18px 20px;border-left:4px solid #3b82f6">
        <div style="font-size:13px;font-weight:700;color:#1e40af;margin-bottom:6px">Payment Instructions</div>
        <div style="font-size:13px;color:#1e40af;line-height:1.6">
          Please pay by the due date shown above. If you have any questions about this invoice, contact us at
          <a href="mailto:support@smartcoretechnology.co.uk" style="color:#1e40af">support@smartcoretechnology.co.uk</a>.
        </div>
      </div>
    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#f9fafb;padding:20px 36px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;text-align:center">
      SmartCore Technology &bull; smartcoretechnology.co.uk &bull; support@smartcoretechnology.co.uk<br>
      Order Reference: ${esc(o.order_reference)} &bull; Invoice: ${inv.invoice_number}
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
  const resendKey  = env.RESEND_SMARTCORE_SHOP;
  const serviceKey = env.SUPABASE_SERVICE_KEY || SUPABASE_ANON;
  const today      = new Date().toISOString().slice(0, 10);

  // 1. Mark overdue invoices
  await sbFetch(
    `/rest/v1/marketplace_invoices?status=eq.sent&due_date=lt.${today}`,
    'PATCH', { status: 'overdue' }, serviceKey
  ).catch(e => console.error('Overdue update failed:', e));

  // 2. Find orders due for billing
  const orders = await sbFetch(
    `/rest/v1/marketplace_orders?status=eq.confirmed&next_billing_date=lte.${today}&select=*`,
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
      const dueDate     = addDays(periodStart, 14);
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

// Allow manual trigger via GET (for testing from HQ)
export async function onRequestGet(context) {
  const { env } = context;
  await onScheduled({}, env);
  return new Response(JSON.stringify({ ok: true, message: 'Invoice cron completed' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
