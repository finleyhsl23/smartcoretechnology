const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export async function onRequestPost({ request, env }) {
  const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  const { token, signer_name } = await request.json();
  if (!token) return new Response(JSON.stringify({ error: 'Token required' }), { status: 400, headers: CORS });
  if (!env.RESEND_API_KEY) return new Response(JSON.stringify({ error: 'Email not configured' }), { status: 500, headers: CORS });

  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';

  // Fetch quote by token
  const qRes = await fetch(
    `${SUPABASE_URL}/rest/v1/crm_quotes?acceptance_token=eq.${encodeURIComponent(token)}&select=*,crm_companies(name)&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const [q] = await qRes.json();
  if (!q) return new Response(JSON.stringify({ error: 'Invalid or expired link' }), { status: 404, headers: CORS });
  if (q.accepted_at) return new Response(JSON.stringify({ error: 'Quote already accepted', already: true }), { status: 409, headers: CORS });
  if (q.status === 'rejected' || q.status === 'expired') {
    return new Response(JSON.stringify({ error: `Quote is ${q.status} and cannot be accepted` }), { status: 409, headers: CORS });
  }

  const tenantId = q.tenant_id;
  const acceptedAt = new Date().toISOString();

  // Mark as accepted
  await fetch(`${SUPABASE_URL}/rest/v1/crm_quotes?id=eq.${q.id}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'accepted', accepted_at: acceptedAt, accepted_by_name: signer_name || null, accepted_ip: ip }),
  });

  // Fetch branding + settings
  const bRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${encodeURIComponent(tenantId)}&select=branding&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [bRow] = await bRes.json();
  const branding = bRow?.branding || {};
  const issuerName   = branding.company_name   || 'SmartCore Technology';
  const primaryColor = branding.primary_color  || '#1e5cff';
  const secondaryColor = branding.secondary_color || '#0a0f1e';
  const logoUrl = branding.prefer_icon ? (branding.icon_url || branding.logo_url) : (branding.logo_url || branding.icon_url);

  const co = q.crm_companies?.name || '';
  const acceptedFormatted = new Date(acceptedAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });

  // Build notification email for staff
  const staffNotifyHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
  <div style="text-align:center;margin-bottom:20px">
    ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(issuerName)}" style="max-height:48px;object-fit:contain"/>` : `<div style="font-size:20px;font-weight:800;color:#1a1a2e">${esc(issuerName)}</div>`}
  </div>

  <!-- Accepted banner -->
  <div style="background:linear-gradient(135deg,#10b981,#059669);border-radius:12px;padding:28px 32px;margin-bottom:20px;text-align:center">
    <div style="font-size:40px;margin-bottom:8px">✅</div>
    <h2 style="margin:0 0 6px;color:#fff;font-size:22px;font-weight:800">Quote Accepted!</h2>
    <p style="margin:0;color:rgba(255,255,255,.85);font-size:14px">${esc(co)} has accepted quote <strong>${esc(q.quote_number||'')}</strong></p>
  </div>

  <!-- Details -->
  <div style="background:#fff;border-radius:12px;padding:28px 32px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,.06)">
    <h3 style="margin:0 0 16px;font-size:16px;color:#1a1a2e">Quote Details</h3>
    <table style="width:100%;border-collapse:collapse">
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;font-size:13px;color:#6b7280;width:140px">Quote Reference</td>
        <td style="padding:10px 0;font-size:13px;font-weight:700;color:#1a1a2e">${esc(q.quote_number||'')}</td>
      </tr>
      ${q.title ? `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;font-size:13px;color:#6b7280">Title</td>
        <td style="padding:10px 0;font-size:13px;font-weight:600;color:#1a1a2e">${esc(q.title)}</td>
      </tr>` : ''}
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;font-size:13px;color:#6b7280">Company</td>
        <td style="padding:10px 0;font-size:13px;font-weight:600;color:#1a1a2e">${esc(co||'—')}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;font-size:13px;color:#6b7280">Total Value</td>
        <td style="padding:10px 0;font-size:16px;font-weight:800;color:#10b981">£${Number(q.total||0).toFixed(2)}</td>
      </tr>
      <tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 0;font-size:13px;color:#6b7280">Accepted By</td>
        <td style="padding:10px 0;font-size:13px;font-weight:600;color:#1a1a2e">${signer_name ? esc(signer_name) : `Contact at ${esc(co||'—')}`}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;font-size:13px;color:#6b7280">Accepted At</td>
        <td style="padding:10px 0;font-size:13px;font-weight:600;color:#1a1a2e">${acceptedFormatted}</td>
      </tr>
    </table>

    <div style="margin-top:24px;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px">
      <p style="margin:0;font-size:13px;color:#166534;line-height:1.6">
        <strong>Next steps:</strong> The quote has been electronically accepted. You can now proceed with raising an invoice or kicking off the project. Log in to the CRM to view the full quote details.
      </p>
    </div>
  </div>

  <div style="text-align:center;font-size:11px;color:#9ca3af;padding-bottom:16px">
    Sent by ${esc(issuerName)} CRM · Quote ${esc(q.quote_number||'')}
  </div>
</div>
</body></html>`;

  // Build confirmation email for the customer
  const customerConfirmHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
  <div style="text-align:center;margin-bottom:20px">
    ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(issuerName)}" style="max-height:48px;object-fit:contain"/>` : `<div style="font-size:20px;font-weight:800;color:#1a1a2e">${esc(issuerName)}</div>`}
  </div>

  <div style="background:#fff;border-radius:12px;padding:28px 32px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,.06)">
    <div style="text-align:center;margin-bottom:24px">
      <div style="width:64px;height:64px;background:#f0fdf4;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:32px">✅</div>
      <h2 style="margin:0 0 6px;font-size:22px;color:#1a1a2e;font-weight:800">Quote Accepted</h2>
      <p style="margin:0;color:#6b7280;font-size:14px">Thank you — we've received your acceptance of quote <strong>${esc(q.quote_number||'')}</strong></p>
    </div>

    <div style="background:#f8f9fc;border-radius:8px;padding:16px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:13px;color:#6b7280">Quote Reference</span>
        <span style="font-size:14px;font-weight:700;color:#1a1a2e">${esc(q.quote_number||'')}</span>
      </div>
      ${q.title ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:13px;color:#6b7280">Title</span>
        <span style="font-size:14px;font-weight:600;color:#1a1a2e">${esc(q.title)}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:8px">
        <span style="font-size:13px;color:#6b7280">Total</span>
        <span style="font-size:18px;font-weight:800;color:#1a1a2e">£${Number(q.total||0).toFixed(2)}</span>
      </div>
    </div>

    <p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 20px">
      A member of the ${esc(issuerName)} team will be in touch shortly to discuss next steps. If you have any questions in the meantime, please don't hesitate to get in touch.
    </p>

    <div style="text-align:center">
      <div style="display:inline-block;background:${primaryColor};color:#fff;padding:4px 16px;border-radius:20px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Accepted ${acceptedFormatted}</div>
    </div>
  </div>

  <div style="text-align:center;font-size:11px;color:#9ca3af;padding-bottom:16px">
    This confirmation was sent by ${esc(issuerName)}.
  </div>
</div>
</body></html>`;

  // Collect staff recipients: contacts linked to the company + assigned lead contact
  const staffEmails = [];

  // Get contacts assigned to this company
  if (q.crm_company_id) {
    const cRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_contacts?crm_company_id=eq.${q.crm_company_id}&email=not.is.null&select=first_name,last_name,email&limit=50`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const contacts = await cRes.json();
    // These are the CUSTOMER's contacts — we want STAFF assigned to this company
    // Actually we want CRM employees who manage this company. Let's get assigned_to from leads or just use the company's account manager field.
    // For now, get all employees of the tenant who are staff (send to all active staff)
  }

  // Simplest robust approach: send to all active employees of the tenant who have an email
  const staffRes = await fetch(
    `${SUPABASE_URL}/rest/v1/core_employees?company_id=eq.${encodeURIComponent(tenantId)}&select=first_name,last_name,email&limit=100`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const staffRows = await staffRes.json();
  for (const s of staffRows || []) {
    if (s.email) staffEmails.push({ email: s.email, name: [s.first_name, s.last_name].filter(Boolean).join(' ') || s.email });
  }

  const emailBatch = [];

  // Staff notifications
  for (const s of staffEmails) {
    emailBatch.push({
      from: `${issuerName} CRM <noreply@smartcoretechnology.co.uk>`,
      to: [s.email],
      subject: `✅ Quote ${q.quote_number} accepted by ${co || 'a customer'}`,
      html: staffNotifyHtml,
    });
  }

  // Customer confirmation
  if (q.contact_email) {
    emailBatch.push({
      from: `${issuerName} <noreply@smartcoretechnology.co.uk>`,
      to: [q.contact_email],
      subject: `Your quote confirmation — ${q.quote_number}`,
      html: customerConfirmHtml,
    });
  }

  if (emailBatch.length > 0) {
    await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailBatch),
    });
  }

  return new Response(JSON.stringify({ ok: true, accepted_at: acceptedAt }), { headers: CORS });
}

// GET: fetch quote by token (for the acceptance page)
export async function onRequestGet({ request, env }) {
  const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return new Response(JSON.stringify({ error: 'Token required' }), { status: 400, headers: CORS });

  const qRes = await fetch(
    `${SUPABASE_URL}/rest/v1/crm_quotes?acceptance_token=eq.${encodeURIComponent(token)}&select=*,crm_companies(name)&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const [q] = await qRes.json();
  if (!q) return new Response(JSON.stringify({ error: 'Invalid or expired link' }), { status: 404, headers: CORS });

  const bRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${encodeURIComponent(q.tenant_id)}&select=branding&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [bRow] = await bRes.json();
  const branding = bRow?.branding || {};

  // Don't expose sensitive fields
  const safe = {
    id: q.id,
    quote_number: q.quote_number,
    title: q.title,
    status: q.status,
    line_items: q.line_items,
    subtotal: q.subtotal,
    discount_amount: q.discount_amount,
    total: q.total,
    date_issued: q.date_issued,
    expiry_date: q.expiry_date,
    notes: q.notes,
    terms: q.terms,
    accepted_at: q.accepted_at,
    accepted_by_name: q.accepted_by_name,
    company_name: q.crm_companies?.name || '',
  };

  return new Response(JSON.stringify({ quote: safe, branding }), { headers: { ...CORS, 'Cache-Control': 'no-store' } });
}
