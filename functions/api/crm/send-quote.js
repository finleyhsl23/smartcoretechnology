const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function buildQuoteHtml({ q, co, branding, acceptUrl, mode }) {
  const primary   = branding.primary_color   || '#1e5cff';
  const secondary = branding.secondary_color || '#0a0f1e';
  const prefer    = branding.prefer_icon === true;
  const logoUrl   = prefer ? (branding.icon_url || branding.logo_url) : (branding.logo_url || branding.icon_url);
  const issuerName = branding.company_name || 'SmartCore Technology';

  const lineItems = q.line_items || [];
  const linesHtml = lineItems.map(li => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-size:14px">${esc(li.description||'')}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:14px">${li.qty||1}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:14px">£${Number(li.unit_price||0).toFixed(2)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-size:14px;font-weight:600">£${Number(li.total||((li.qty||1)*(li.unit_price||0))).toFixed(2)}</td>
    </tr>`).join('');

  const sub   = Number(q.subtotal || 0);
  const disc  = Number(q.discount_amount || 0);
  const total = sub > 0 ? Math.max(0, sub - disc) : Number(q.total || 0);
  const issued  = q.date_issued  ? new Date(q.date_issued ).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—';
  const expires = q.expiry_date  ? new Date(q.expiry_date ).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—';

  const actionSection = mode === 'email' ? `
    <div style="text-align:center;margin:32px 0">
      <a href="${acceptUrl}" style="display:inline-block;background:${primary};color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:16px 40px;border-radius:8px;letter-spacing:.3px">
        Review &amp; Sign Quote
      </a>
      <p style="margin-top:12px;font-size:12px;color:#9ca3af">Or copy this link: <a href="${acceptUrl}" style="color:${primary};word-break:break-all">${acceptUrl}</a></p>
    </div>` : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Quote ${esc(q.quote_number||'')}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f3f4f6;color:#1a1a2e}
  .wrap{max-width:720px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  @media print{body{background:#fff}.wrap{box-shadow:none;border-radius:0}}
</style></head>
<body style="padding:${mode==='email'?'0':'32px 16px'}">
<div class="wrap">

  <!-- Header -->
  <div style="background:${secondary};padding:36px 40px;display:flex;justify-content:space-between;align-items:flex-start">
    <div>
      ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(issuerName)}" style="max-height:56px;max-width:180px;object-fit:contain"/>` : `<div style="font-size:22px;font-weight:800;color:#fff">${esc(issuerName)}</div>`}
    </div>
    <div style="text-align:right">
      <div style="background:${primary};color:#fff;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:2px;padding:5px 14px;border-radius:4px;display:inline-block;margin-bottom:8px">Quote</div>
      <div style="font-size:26px;font-weight:900;color:#fff">${esc(q.quote_number||'QT-000')}</div>
      <div style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:4px;padding:3px 12px;font-size:11px;font-weight:700;text-transform:uppercase;display:inline-block;margin-top:6px">${(q.status||'draft').toUpperCase()}</div>
    </div>
  </div>

  <!-- Meta grid -->
  <div style="padding:28px 40px 0">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:28px">
      <div style="background:#f8f9fc;border-radius:8px;padding:14px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:700;margin-bottom:4px">Prepared for</div>
        <div style="font-size:15px;font-weight:700;color:#1a1a2e">${esc(co||'—')}</div>
      </div>
      <div style="background:#f8f9fc;border-radius:8px;padding:14px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:700;margin-bottom:4px">Quote Title</div>
        <div style="font-size:15px;font-weight:700;color:#1a1a2e">${esc(q.title||'—')}</div>
      </div>
      <div style="background:#f8f9fc;border-radius:8px;padding:14px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:700;margin-bottom:4px">Date Issued</div>
        <div style="font-size:14px;font-weight:600;color:#1a1a2e">${issued}</div>
      </div>
      <div style="background:#f8f9fc;border-radius:8px;padding:14px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;font-weight:700;margin-bottom:4px">Valid Until</div>
        <div style="font-size:14px;font-weight:600;color:#1a1a2e">${expires}</div>
      </div>
    </div>

    <!-- Action button (email only) -->
    ${actionSection}

    <!-- Line items -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <thead>
        <tr style="background:${primary};color:#fff">
          <th style="padding:10px 14px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Description</th>
          <th style="padding:10px 14px;text-align:center;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Qty</th>
          <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Unit Price</th>
          <th style="padding:10px 14px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Total</th>
        </tr>
      </thead>
      <tbody>
        ${linesHtml || `<tr><td colspan="4" style="padding:16px;text-align:center;color:#9ca3af">No line items</td></tr>`}
      </tbody>
    </table>

    <!-- Totals -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
      <div style="min-width:260px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #e5e7eb;font-size:13px"><span>Subtotal</span><span>£${(sub||total).toFixed(2)}</span></div>
        ${disc > 0 ? `<div style="display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #e5e7eb;font-size:13px"><span>Discount</span><span>-£${disc.toFixed(2)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:12px 16px;background:${primary};color:#fff;font-weight:800;font-size:16px"><span>TOTAL</span><span>£${total.toFixed(2)}</span></div>
      </div>
    </div>

    ${q.notes ? `<div style="background:#f8f9fc;border-radius:8px;padding:16px;margin-bottom:16px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:6px">Notes</div><div style="font-size:13px;color:#374151;line-height:1.6;white-space:pre-wrap">${esc(q.notes)}</div></div>` : ''}
    <div style="background:#f8f9fc;border-radius:8px;padding:16px;margin-bottom:28px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:6px">Terms &amp; Conditions</div><div style="font-size:13px;color:#374151;line-height:1.6;white-space:pre-wrap">${esc(q.terms||'Payment due within 30 days.')}</div></div>
  </div>

  <!-- Footer -->
  <div style="background:#f8f9fc;border-top:1px solid #e5e7eb;padding:16px 40px;text-align:center;font-size:11px;color:#9ca3af">
    This document is a QUOTE only and does not constitute an invoice. Ref: ${esc(q.quote_number||'')} · ${issuerName}
  </div>
</div>
</body>
</html>`;
}

export async function onRequestPost({ request, env }) {
  const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: CORS });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: CORS });
  const { id: authUserId } = await userRes.json();

  const empRes = await fetch(`${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${authUserId}&select=company_id,first_name,last_name&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [emp] = await empRes.json();
  if (!emp) return new Response(JSON.stringify({ error: 'Employee not found' }), { status: 403, headers: CORS });
  const tenantId = emp.company_id;

  const { quote_id, contact_email, recipient_name } = await request.json();
  if (!quote_id) return new Response(JSON.stringify({ error: 'quote_id required' }), { status: 400, headers: CORS });
  if (!contact_email) return new Response(JSON.stringify({ error: 'contact_email required' }), { status: 400, headers: CORS });
  if (!env.RESEND_API_KEY) return new Response(JSON.stringify({ error: 'Email not configured' }), { status: 500, headers: CORS });

  // Fetch quote
  const qRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_quotes?id=eq.${quote_id}&tenant_id=eq.${tenantId}&select=*,crm_companies(name)&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [q] = await qRes.json();
  if (!q) return new Response(JSON.stringify({ error: 'Quote not found' }), { status: 404, headers: CORS });

  // Fetch branding
  const bRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${tenantId}&select=branding&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [bRow] = await bRes.json();
  const branding = bRow?.branding || {};
  const issuerName  = branding.company_name  || 'SmartCore Technology';
  const primaryColor = branding.primary_color || '#1e5cff';
  const logoUrl = branding.prefer_icon ? (branding.icon_url || branding.logo_url) : (branding.logo_url || branding.icon_url);

  // Generate token
  const acceptanceToken = crypto.randomUUID();

  // Determine base URL from request
  const origin = new URL(request.url).origin;
  const acceptUrl = `${origin}/systems/crm/quote-accept.html?token=${acceptanceToken}`;

  const co = q.crm_companies?.name || '';
  const quoteHtml = buildQuoteHtml({ q, co, branding, acceptUrl, mode: 'email' });

  // Email subject
  const subject = `Quote ${q.quote_number} from ${issuerName}${q.title ? ` — ${q.title}` : ''}`;

  // Full email wrapper
  const emailHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:720px;margin:0 auto;padding:24px 16px">
  <div style="text-align:center;margin-bottom:20px">
    ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(issuerName)}" style="max-height:48px;object-fit:contain"/>` : `<div style="font-size:20px;font-weight:800;color:#1a1a2e">${esc(issuerName)}</div>`}
  </div>
  <div style="background:#fff;border-radius:12px;padding:28px 32px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,.06)">
    <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e">You have a new quote</h2>
    <p style="margin:0 0 20px;color:#6b7280;font-size:14px;line-height:1.6">
      Hi ${esc(recipient_name || co || 'there')},<br/><br/>
      ${esc(issuerName)} has sent you a quote. Please review the details below and use the button to accept or discuss it with us.
    </p>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:140px;background:#f8f9fc;border-radius:8px;padding:12px 16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;font-weight:700;margin-bottom:3px">Quote Ref</div>
        <div style="font-size:16px;font-weight:800;color:#1a1a2e">${esc(q.quote_number||'')}</div>
      </div>
      <div style="flex:1;min-width:140px;background:#f8f9fc;border-radius:8px;padding:12px 16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;font-weight:700;margin-bottom:3px">Total Value</div>
        <div style="font-size:16px;font-weight:800;color:#1a1a2e">£${Number(q.total||0).toFixed(2)}</div>
      </div>
      ${q.expiry_date ? `<div style="flex:1;min-width:140px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px 16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9a3412;font-weight:700;margin-bottom:3px">Valid Until</div>
        <div style="font-size:14px;font-weight:700;color:#9a3412">${new Date(q.expiry_date).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</div>
      </div>` : ''}
    </div>
    <div style="text-align:center;margin-top:28px">
      <a href="${acceptUrl}" style="display:inline-block;background:${primaryColor};color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:16px 44px;border-radius:8px;letter-spacing:.3px">
        Review &amp; Sign Quote →
      </a>
      <p style="margin-top:10px;font-size:11px;color:#9ca3af">Or copy this link into your browser:<br/><a href="${acceptUrl}" style="color:${primaryColor};word-break:break-all">${acceptUrl}</a></p>
    </div>
  </div>

  <!-- Quote preview card -->
  <div style="background:#fff;border-radius:12px;padding:0;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.06);margin-bottom:20px">
    ${quoteHtml.replace(/<!DOCTYPE html>[\s\S]*?<body[^>]*>/, '').replace('</body></html>', '').replace(/<style>[\s\S]*?<\/style>/,'')}
  </div>

  <div style="text-align:center;font-size:11px;color:#9ca3af;padding-bottom:16px">
    This email was sent by ${esc(issuerName)}. If you have questions, please reply to this email or contact us directly.
  </div>
</div>
</body></html>`;

  // Send email
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${issuerName} <noreply@smartcoretechnology.co.uk>`,
      to: [contact_email],
      subject,
      html: emailHtml,
    }),
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    return new Response(JSON.stringify({ error: `Email failed: ${errText}` }), { status: 500, headers: CORS });
  }

  // Update quote: store token, contact_email, sent_at, status=sent
  await fetch(`${SUPABASE_URL}/rest/v1/crm_quotes?id=eq.${quote_id}&tenant_id=eq.${tenantId}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ acceptance_token: acceptanceToken, contact_email, sent_at: new Date().toISOString(), status: 'sent' }),
  });

  return new Response(JSON.stringify({ ok: true }), { headers: CORS });
}
