/**
 * POST /api/payment-complete
 *
 * Called from the payment page after Stripe confirms payment.
 * Body: { order_id, result: 'success' | 'failed', source?: 'stripe' }
 *
 * On success → approve order, provision modules, send welcome email + PDF invoice.
 * On failure → mark payment_failed.
 *
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY
 */

const ADMIN_EMAIL   = 'support@smartcoretechnology.co.uk';
const FROM          = 'SmartCore <noreply@smartcoretechnology.co.uk>';
const FROM_BILLING  = 'SmartCore Billing <noreply@smartcoretechnology.co.uk>';
const SITE          = 'https://smartcoretechnology.co.uk';

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json',
  };

  try {
    const { order_id, result } = await request.json();
    if (!order_id || !['success','failed'].includes(result)) {
      return json({ error: 'order_id and result (success|failed) required' }, 400, cors);
    }

    const order = await dbGet(env, `/marketplace_orders?id=eq.${enc(order_id)}&select=*&limit=1`);
    if (!order?.[0]) return json({ error: 'Order not found' }, 404, cors);
    const o = order[0];

    if (!['pending_payment', 'pending', 'approved'].includes(o.status)) {
      return json({ error: 'Order already processed', status: o.status }, 400, cors);
    }

    if (result === 'failed') {
      await dbPatch(env, `/marketplace_orders?id=eq.${enc(order_id)}`, { status: 'payment_failed' });
      return json({ success: false, message: 'Payment was declined. Please try again or contact support.' }, 200, cors);
    }

    // --- Success path ---
    const today       = new Date().toISOString().slice(0, 10);
    const nextBilling = o.billing_type === 'yearly' ? addYear(today) : addMonth(today);

    await dbPatch(env, `/marketplace_orders?id=eq.${enc(order_id)}`, {
      status:                 'approved',
      reviewed_at:            new Date().toISOString(),
      subscription_start_date: today,
      next_billing_date:      nextBilling,
    });

    const modules = parseModules(o.modules);
    const oFull   = { ...o, subscription_start_date: today, next_billing_date: nextBilling };

    // Provision modules (best-effort)
    try { await provisionModules(env, o); } catch (e) { console.error('provision error:', e); }

    // Provision CRM extras (best-effort)
    try { await provisionCRM(env, o); } catch (e) { console.error('crm provision error:', e); }

    // Send welcome email with PDF invoice attached (best-effort)
    try { await sendWelcomeWithInvoice(env, oFull, modules, today); } catch (e) { console.error('email error:', e); }

    return json({
      success:  true,
      redirect: `/shop/order-confirmed.html?ref=${enc(o.order_reference)}&company=${enc(o.company_name)}`,
    }, 200, cors);

  } catch (err) {
    console.error('payment-complete:', err);
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
// Provisioning — finds existing company by email to avoid duplicates
// ---------------------------------------------------------------------------
async function provisionModules(env, o) {
  // Look for an existing company by email first (handles re-orders from existing customers)
  let company;
  const byEmail = await dbGet(env, `/smartcore_core_companies?company_email=eq.${enc(o.email)}&select=id&limit=1`);
  if (byEmail?.length) {
    company = byEmail[0];
  } else {
    // Check by order_id in case of retry
    const byOrder = await dbGet(env, `/smartcore_core_companies?order_id=eq.${enc(o.id)}&select=id&limit=1`);
    if (byOrder?.length) {
      company = byOrder[0];
    } else {
      // Create new company
      const rows = await dbPost(env, '/smartcore_core_companies', {
        order_id:       o.id,
        company_name:   o.company_name,
        company_email:  o.email,
        company_phone:  o.phone || null,
        staff_count:    o.staff_count || null,
        status:         'active',
        provisioned_at: new Date().toISOString(),
      }, true);
      company = Array.isArray(rows) ? rows[0] : rows;
    }
  }

  if (!company?.id) return;

  // Link the ordering user's auth account to this company (if we have their auth_user_id)
  if (o.auth_user_id) {
    const empExists = await dbGet(env, `/core_employees?company_id=eq.${enc(company.id)}&user_id=eq.${enc(o.auth_user_id)}&select=id&limit=1`);
    if (!empExists?.length) {
      await dbPost(env, '/core_employees', {
        company_id:  company.id,
        employee_id: `EMP-${o.auth_user_id.slice(0, 8).toUpperCase()}`,
        full_name:   o.contact_name || o.email,
        user_id:     o.auth_user_id,
        role:        'owner',
      }).catch(e => console.error('core_employees insert error:', e));
    }
  }

  // Add any purchased modules not already provisioned
  const existing = await dbGet(env, `/smartcore_core_purchased_modules?company_id=eq.${enc(company.id)}&select=module_slug`);
  const existingSlugs = new Set((existing || []).map(r => r.module_slug));

  const modules = parseModules(o.modules);
  const all = [
    { slug: 'smartcore-core', name: 'SmartCore Core', price: 0 },
    ...modules.filter(m => m.slug !== 'smartcore-core'),
  ];

  for (const m of all) {
    if (existingSlugs.has(m.slug)) continue;
    await dbPost(env, '/smartcore_core_purchased_modules', {
      company_id:   company.id,
      order_id:     o.id,
      module_slug:  m.slug,
      module_name:  m.name,
      billing_type: o.billing_type,
      price:        m.price || 0,
      status:       'active',
      activated_at: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// CRM Provisioning
// ---------------------------------------------------------------------------
const CRM_TIER_MAP = {
  'smartcore-crm-lite':         'lite',
  'smartcore-crm-professional': 'professional',
  'smartcore-crm-business':     'business',
  'smartcore-crm-enterprise':   'enterprise',
};

async function provisionCRM(env, o) {
  const modules   = parseModules(o.modules);
  const crmModule = modules.find(m => CRM_TIER_MAP[m.slug]);
  if (!crmModule) return;

  const tier = CRM_TIER_MAP[crmModule.slug];

  const byEmail = await dbGet(env, `/smartcore_core_companies?company_email=eq.${enc(o.email)}&select=id&limit=1`);
  const company = byEmail?.[0];
  if (!company?.id) return;

  await fetch(`${env.SUPABASE_URL}/rest/v1/company_modules`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      company_id:   company.id,
      module_key:   'smartcore-crm',
      enabled:      true,
      tier,
      activated_at: new Date().toISOString(),
    }),
  });

  const defaultStages = [
    { name: 'New',           color: '#6366f1', order: 0 },
    { name: 'Contacted',     color: '#f59e0b', order: 1 },
    { name: 'Qualified',     color: '#3b82f6', order: 2 },
    { name: 'Proposal Sent', color: '#8b5cf6', order: 3 },
    { name: 'Negotiation',   color: '#ec4899', order: 4 },
    { name: 'Won',           color: '#22c55e', order: 5 },
    { name: 'Lost',          color: '#ef4444', order: 6 },
  ];
  await fetch(`${env.SUPABASE_URL}/rest/v1/crm_settings`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({ tenant_id: company.id, tier, pipeline_stages: defaultStages }),
  });
}

// ---------------------------------------------------------------------------
// Email: single welcome email with PDF invoice attachment
// ---------------------------------------------------------------------------
async function sendWelcomeWithInvoice(env, o, modules, today) {
  const invoiceNum  = await nextInvoiceNumber(env);
  const periodEnd   = o.billing_type === 'yearly' ? addYear(today) : addMonth(today);
  const multiplier  = o.size_multiplier || 1;
  const regular     = modules.filter(m => m.slug !== 'smartcore-core');

  const subtotal = regular.reduce((s, m) => {
    const isFlat = m.is_flat_rate;
    const base   = o.billing_type === 'yearly' ? (m.yearly_price || m.monthly_price) : m.monthly_price;
    return s + (base || 0) * (isFlat ? 1 : multiplier);
  }, 0);
  const discount    = o.discount_amount || 0;
  const annualDisc  = o.annual_discount_amount || 0;
  const total       = Math.max(0, subtotal - discount - annualDisc);

  const inv = {
    invoice_number:       invoiceNum,
    order_id:             o.id,
    company_name:         o.company_name,
    contact_name:         o.contact_name,
    contact_email:        o.email,
    accounts_email:       o.accounts_email || o.email,
    modules,
    billing_type:         o.billing_type,
    size_tier:            o.size_tier,
    size_multiplier:      multiplier,
    subtotal,
    discount_amount:      discount,
    total,
    billing_period_start: today,
    billing_period_end:   periodEnd,
    due_date:             today,
    status:               'sent',
  };

  await dbPost(env, '/marketplace_invoices', inv, false);

  const pdfBase64 = buildInvoicePdf(inv, o, modules);
  const html      = welcomeHtml(o, modules, inv);

  const recipients = [...new Set([o.email, o.accounts_email].filter(Boolean))];
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    FROM,
      to:      recipients,
      subject: `Welcome to SmartCore — ${o.order_reference}`,
      html,
      attachments: [{
        filename:     `SmartCore-Invoice-${inv.invoice_number}.pdf`,
        content:      pdfBase64,
        content_type: 'application/pdf',
      }],
    }),
  });
}

// ---------------------------------------------------------------------------
// Invoice number
// ---------------------------------------------------------------------------
async function nextInvoiceNumber(env) {
  const year = new Date().getFullYear();
  const rows = await dbGet(env, `/marketplace_invoices?invoice_number=like.INV-${year}-%25&select=invoice_number&order=invoice_number.desc&limit=1`);
  const last = rows?.[0]?.invoice_number;
  const seq  = last ? parseInt(last.split('-')[2] || '0', 10) + 1 : 1;
  return `INV-${year}-${String(seq).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// PDF builder (pure base64, no external libs — uses a minimal PDF structure)
// ---------------------------------------------------------------------------
function buildInvoicePdf(inv, o, modules) {
  const regular    = modules.filter(m => m.slug !== 'smartcore-core');
  const period     = o.billing_type === 'yearly' ? '/yr' : '/mo';
  const multiplier = o.size_multiplier || 1;
  const fmtGbp     = n => '£' + Number(n || 0).toFixed(2);
  const fmtD       = iso => new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });

  const lineItems = [
    { desc: 'SmartCore Core', price: 'Free' },
    ...regular.map(m => {
      const base    = inv.billing_type === 'yearly' ? (m.yearly_price || m.monthly_price) : m.monthly_price;
      const isFlat  = !!m.is_flat_rate;
      const price   = (base || 0) * (isFlat ? 1 : multiplier);
      return { desc: m.name, price: fmtGbp(price) + period };
    }),
  ];

  // Build a minimal but complete PDF using raw PDF syntax
  const textLines = [
    ['SmartCore Technology',                          36, 760, 18, true],
    ['Invoice ' + inv.invoice_number,                 36, 735, 13, false],
    ['support@smartcoretechnology.co.uk',             36, 720, 10, false],
    ['www.smartcoretechnology.co.uk',                 36, 708, 10, false],
    ['',                                              36, 696, 10, false],
    ['BILLED TO',                                     36, 680, 9,  true],
    [o.company_name,                                  36, 668, 12, true],
    [o.contact_name,                                  36, 655, 10, false],
    [inv.accounts_email || o.email,                   36, 643, 10, false],
    ['Invoice No:  ' + inv.invoice_number,            370, 680, 10, false],
    ['Invoice Date:  ' + fmtD(inv.billing_period_start), 370, 668, 10, false],
    ['Due Date:  ' + fmtD(inv.due_date),              370, 656, 10, false],
    ['',                                              36,  625, 10, false],
    ['DESCRIPTION',                                   36,  610, 9,  true],
    ['AMOUNT',                                        480, 610, 9,  true],
  ];

  let y = 595;
  for (const li of lineItems) {
    textLines.push([li.desc,  36,  y, 10, false]);
    textLines.push([li.price, 480, y, 10, false]);
    y -= 16;
  }
  y -= 8;
  if (inv.discount_amount > 0) {
    textLines.push(['Package Discount',        36,  y, 10, false]);
    textLines.push(['-' + fmtGbp(inv.discount_amount), 480, y, 10, false]);
    y -= 16;
  }
  textLines.push(['TOTAL DUE',        36,  y - 8, 12, true]);
  textLines.push([fmtGbp(inv.total) + period, 480, y - 8, 12, true]);
  textLines.push(['Payment collected securely via Stripe.', 36, y - 32, 9, false]);
  textLines.push(['Order: ' + o.order_reference + '  |  Period: ' + fmtD(inv.billing_period_start) + ' – ' + fmtD(inv.billing_period_end), 36, y - 48, 8, false]);

  // Encode to PDF content stream
  let stream = 'BT\n';
  for (const [text, x, yy, size, bold] of textLines) {
    const safe = String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    stream += `/${bold ? 'F2' : 'F1'} ${size} Tf\n${x} ${yy} Td\n(${safe}) Tj\n-${x} -${yy} Td\n`;
  }
  stream += 'ET\n';

  const streamBytes = encodeUtf8(stream);
  const streamLen   = streamBytes.length;

  const objects = [];
  // obj 1: catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  // obj 2: pages
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
  // obj 3: page
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj');
  // obj 4: content stream
  objects.push(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj`);
  // obj 5: Helvetica
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
  // obj 6: Helvetica-Bold
  objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj');

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj + '\n';
  }
  const xrefOffset = pdf.length;
  pdf += 'xref\n';
  pdf += `0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const off of offsets) {
    pdf += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\n';
  pdf += 'startxref\n' + xrefOffset + '\n%%EOF';

  return btoa(pdf);
}

function encodeUtf8(str) {
  let bytes = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) bytes += str[i];
    else bytes += '?';
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Welcome email template
// ---------------------------------------------------------------------------
function welcomeHtml(o, modules, inv) {
  const regular = modules.filter(m => m.slug !== 'smartcore-core');
  const date = new Date(o.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
  const multiplier = o.size_multiplier || 1;

  const modRows = [
    `<div class="row"><span>SmartCore Core</span><span style="color:#22c55e;font-weight:600">Included free</span></div>`,
    ...regular.map(m => {
      const base  = o.billing_type === 'yearly' ? (m.yearly_price || m.monthly_price) : m.monthly_price;
      const price = (base || 0) * (m.is_flat_rate ? 1 : multiplier);
      return `<div class="row"><span>${esc(m.name)}</span><span style="font-weight:600">${fmt(price)}/${o.billing_type === 'yearly' ? 'yr' : 'mo'}</span></div>`;
    }),
  ].join('');

  const discounts = [];
  if ((o.discount_amount || 0) > 0) discounts.push(`<div class="row"><span style="color:#64748b">Package discount</span><span style="color:#22c55e;font-weight:600">−${fmt(o.discount_amount)}</span></div>`);
  if ((o.annual_discount_amount || 0) > 0) discounts.push(`<div class="row"><span style="color:#64748b">Annual billing (8%)</span><span style="color:#22c55e;font-weight:600">−${fmt(o.annual_discount_amount)}</span></div>`);

  const hasCrm = modules.some(m => m.slug && m.slug.startsWith('smartcore-crm'));
  const steps = [
    { n: '1', title: 'Log in to SmartCore', body: `Head to <a href="${SITE}/modules" style="color:#3b82f6">smartcoretechnology.co.uk/modules</a> and sign in with the email address you used to purchase.` },
    { n: '2', title: 'Explore your modules', body: 'Your home screen gives you an overview of all your active modules. Non-activated ones appear at the bottom, ready for purchase when you need them. Hover over any active module and press the settings icon to control who in your team can access it.' },
    { n: '3', title: 'Build your team', body: 'Open the <strong>SmartCore Core</strong> module to manage your team. Press <strong>Add Employee</strong> to get started. In Settings you can manage departments, shift patterns, and onboarding questions.' },
    ...(hasCrm ? [{ n: '4', title: 'Set up your CRM', body: 'Open <strong>SmartCore CRM</strong> from your dashboard. Your default pipeline stages are ready — customise them to fit your sales process.' }] : []),
  ];

  const stepHtml = steps.map(s => `
    <div style="display:flex;gap:14px;margin-bottom:16px;align-items:flex-start">
      <div style="min-width:28px;height:28px;border-radius:50%;background:#3b82f6;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;line-height:1">${s.n}</div>
      <div><p style="margin:0 0 4px;font-weight:700;color:#0f172a;font-size:14px">${s.title}</p><p style="margin:0;font-size:13px;color:#475569;line-height:1.6">${s.body}</p></div>
    </div>`).join('');

  return shell(
    `Welcome to SmartCore! Your order ${o.order_reference} is active.`,
    `<span class="tag">✓ Welcome to SmartCore</span>
    <h1>You're all set, ${esc(o.contact_name)}!</h1>
    <p>Your payment has been received and your SmartCore modules are now live. A copy of your invoice is attached to this email.</p>
    <div class="ref">${esc(o.order_reference)}</div>
    <p style="font-size:13px;color:#64748b;margin-bottom:16px">Order placed ${date} &bull; ${o.billing_type === 'yearly' ? 'Annual' : 'Monthly'} billing &bull; Invoice ${inv.invoice_number}</p>
    ${modRows}
    ${discounts.join('')}
    <div class="total"><span>Total</span><span>${fmt(inv.total)}/${o.billing_type === 'yearly' ? 'yr' : 'mo'}</span></div>
    <br>
    <p style="font-weight:700;color:#0f172a;margin-bottom:12px">Getting started</p>
    ${stepHtml}
    <br>
    <a href="${SITE}/modules" class="btn">Open SmartCore →</a>
    <br>
    <p>Questions? Contact us at <a href="mailto:support@smartcoretechnology.co.uk" style="color:#3b82f6">support@smartcoretechnology.co.uk</a></p>`
  );
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
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}

async function dbPost(env, path, body, returning = false) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: returning ? 'return=representation' : 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  if (returning) return r.json();
}

function parseModules(m) {
  if (!m) return [];
  if (Array.isArray(m)) return m;
  try { return JSON.parse(m); } catch { return []; }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });
}

// ---------------------------------------------------------------------------
// Email shell
// ---------------------------------------------------------------------------
function fmt(n) {
  return '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function shell(preheader, body) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif}
.wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,.08)}
.hdr{background:#020617;padding:24px 32px}
.body{padding:32px}h1{font-size:22px;font-weight:800;margin:0 0 8px;color:#0f172a}
p{font-size:14px;line-height:1.7;color:#334155;margin:0 0 14px}
.btn{display:inline-block;background:#3b82f6;color:#fff!important;text-decoration:none;font-weight:700;font-size:14px;padding:13px 28px;border-radius:10px;margin:8px 0 20px}
.ref{background:#eff6ff;border-radius:10px;padding:16px 20px;margin:16px 0;font-family:ui-monospace,monospace;font-size:22px;font-weight:800;color:#2563eb;letter-spacing:.06em}
.tag{display:inline-block;background:#22c55e;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;margin-bottom:12px}
.row{display:flex;justify-content:space-between;font-size:14px;padding:6px 0;border-bottom:1px solid #f1f5f9}
.total{display:flex;justify-content:space-between;font-size:16px;font-weight:800;padding:10px 0;color:#0f172a;border-top:2px solid #e2e8f0;margin-top:4px}
.ftr{padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center}</style>
</head><body>
<div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div>
<div class="wrap">
<div class="hdr"><table cellpadding="0" cellspacing="0"><tr>
  <td style="width:42px;height:42px;border-radius:12px;overflow:hidden;vertical-align:middle"><img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" width="42" height="42" style="display:block;border-radius:12px" /></td>
  <td style="padding-left:12px;color:#fff;font-size:15px;font-weight:700">SmartCore Technology</td>
</tr></table></div>
<div class="body">${body}</div>
<div class="ftr">SmartCore Technology &bull; <a href="${SITE}" style="color:#3b82f6">${SITE.replace('https://','')}</a><br><a href="mailto:support@smartcoretechnology.co.uk" style="color:#3b82f6">support@smartcoretechnology.co.uk</a></div>
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function addMonth(d) {
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()).toISOString().slice(0, 10);
}
function addYear(d) {
  const dt = new Date(d);
  return new Date(dt.getFullYear() + 1, dt.getMonth(), dt.getDate()).toISOString().slice(0, 10);
}
