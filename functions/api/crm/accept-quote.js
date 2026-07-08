const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// GET — public, returns quote data + branding by token
export async function onRequestGet({ request, env }) {
  try {
    const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return json({ error: 'Token required' }, 400);

    const qRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_quotes?acceptance_token=eq.${encodeURIComponent(token)}&select=*&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const qData = await qRes.json();
    const q = Array.isArray(qData) ? qData[0] : null;
    if (!q) return json({ error: 'Invalid or expired link' }, 404);

    // Fetch company name + branding separately
    const fetches = [
      fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${encodeURIComponent(q.tenant_id)}&select=branding&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }),
    ];
    if (q.crm_company_id) {
      fetches.push(
        fetch(`${SUPABASE_URL}/rest/v1/crm_companies?id=eq.${q.crm_company_id}&select=name&limit=1`,
          { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
      );
    }
    const [bRes, cRes] = await Promise.all(fetches);
    const bData = await bRes.json();
    const branding = (Array.isArray(bData) ? bData[0]?.branding : null) || {};
    let companyName = '';
    if (cRes) {
      const cData = await cRes.json();
      companyName = (Array.isArray(cData) ? cData[0]?.name : null) || '';
    }

    return new Response(JSON.stringify({
      quote: {
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
        company_name: companyName,
      },
      branding,
    }), { headers: { ...CORS, 'Cache-Control': 'no-store' } });

  } catch (err) {
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}

// POST — accept the quote
export async function onRequestPost({ request, env }) {
  try {
    const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'Invalid request body' }, 400); }
    const { token, signer_name } = body || {};
    if (!token) return json({ error: 'Token required' }, 400);

    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';

    // Fetch quote by token
    const qRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_quotes?acceptance_token=eq.${encodeURIComponent(token)}&select=*&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const qData = await qRes.json();
    const q = Array.isArray(qData) ? qData[0] : null;
    if (!q) return json({ error: 'Invalid or expired link' }, 404);
    if (q.accepted_at) return json({ error: 'Quote already accepted', already: true }, 409);
    if (q.status === 'rejected') return json({ error: 'This quote has been declined and cannot be accepted' }, 409);
    if (q.status === 'expired') return json({ error: 'This quote has expired and cannot be accepted' }, 409);

    const tenantId   = q.tenant_id;
    const acceptedAt = new Date().toISOString();

    // Mark accepted
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_quotes?id=eq.${q.id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status: 'accepted',
          accepted_at: acceptedAt,
          accepted_by_name: signer_name || null,
          accepted_ip: ip || null,
        }),
      }
    );
    if (!patchRes.ok) {
      const errText = await patchRes.text().catch(() => '');
      return json({ error: `Failed to save acceptance: ${errText}` }, 500);
    }

    // Fetch branding + company + staff in parallel
    const [bRes, staffRes, cRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${encodeURIComponent(tenantId)}&select=branding&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }),
      fetch(`${SUPABASE_URL}/rest/v1/core_employees?company_id=eq.${encodeURIComponent(tenantId)}&select=first_name,last_name,email&limit=100`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }),
      q.crm_company_id
        ? fetch(`${SUPABASE_URL}/rest/v1/crm_companies?id=eq.${q.crm_company_id}&select=name&limit=1`,
            { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
        : Promise.resolve(null),
    ]);

    const bData    = await bRes.json();
    const branding = (Array.isArray(bData) ? bData[0]?.branding : null) || {};
    const staffData = await staffRes.json();
    const staff    = Array.isArray(staffData) ? staffData : [];
    let coName = '';
    if (cRes) {
      const cData = await cRes.json();
      coName = (Array.isArray(cData) ? cData[0]?.name : null) || '';
    }

    const issuerName    = branding.company_name    || 'SmartCore Technology';
    const primaryColor  = branding.primary_color   || '#1e5cff';
    const logoUrl = branding.prefer_icon
      ? (branding.icon_url || branding.logo_url)
      : (branding.logo_url || branding.icon_url);

    const acceptedFormatted = new Date(acceptedAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    const total = Number(q.total || 0);

    // Staff notification email
    const staffHtml = [
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>',
      `<title>Quote ${esc(q.quote_number || '')} Accepted</title></head>`,
      `<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:24px 0">`,
      `<tr><td align="center">`,
      `<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">`,
      // Logo
      `<tr><td align="center" style="padding:0 16px 20px">`,
      logoUrl
        ? `<img src="${esc(logoUrl)}" alt="${esc(issuerName)}" height="44" style="display:block;max-height:44px"/>`
        : `<div style="font-size:20px;font-weight:800;color:#1a1a2e">${esc(issuerName)}</div>`,
      `</td></tr>`,
      // Green banner
      `<tr><td style="padding:0 16px 20px">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#10b981,#059669);border-radius:12px">`,
      `<tr><td align="center" style="padding:28px 32px">`,
      `<div style="font-size:40px;margin-bottom:8px">&#9989;</div>`,
      `<h2 style="margin:0 0 6px;color:#ffffff;font-size:22px;font-weight:800">Quote Accepted!</h2>`,
      `<p style="margin:0;color:rgba(255,255,255,.85);font-size:14px">${esc(coName || 'A customer')} has accepted quote <strong>${esc(q.quote_number || '')}</strong></p>`,
      `</td></tr></table></td></tr>`,
      // Details
      `<tr><td style="padding:0 16px 20px">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px">`,
      `<tr><td style="padding:28px 32px">`,
      `<h3 style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1a1a2e">Quote Details</h3>`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0">`,
      row('Quote Reference', esc(q.quote_number || '')),
      q.title ? row('Title', esc(q.title)) : '',
      row('Company', esc(coName || '—')),
      `<tr><td style="padding:10px 0;font-size:13px;color:#6b7280;width:140px;border-bottom:1px solid #f3f4f6">Total Value</td>`,
      `<td style="padding:10px 0;font-size:16px;font-weight:800;color:#10b981;border-bottom:1px solid #f3f4f6">&#163;${total.toFixed(2)}</td></tr>`,
      row('Accepted By', signer_name ? esc(signer_name) : `Contact at ${esc(coName || '—')}`),
      `<tr><td style="padding:10px 0;font-size:13px;color:#6b7280">Accepted At</td>`,
      `<td style="padding:10px 0;font-size:13px;font-weight:600;color:#1a1a2e">${acceptedFormatted}</td></tr>`,
      `</table>`,
      `<div style="margin-top:20px;padding:14px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;font-size:13px;color:#166534;line-height:1.6">`,
      `<strong>Next steps:</strong> The quote has been electronically accepted. You can now raise an invoice or begin the project.`,
      `</div>`,
      `</td></tr></table></td></tr>`,
      // Footer
      `<tr><td align="center" style="padding:0 16px 32px;font-size:11px;color:#9ca3af">`,
      `Sent by ${esc(issuerName)} CRM &middot; Quote ${esc(q.quote_number || '')}`,
      `</td></tr>`,
      `</table></td></tr></table></body></html>`,
    ].join('\n');

    // Customer confirmation email
    const customerHtml = [
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>',
      `<title>Quote Confirmation</title></head>`,
      `<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:24px 0">`,
      `<tr><td align="center">`,
      `<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">`,
      // Logo
      `<tr><td align="center" style="padding:0 16px 20px">`,
      logoUrl
        ? `<img src="${esc(logoUrl)}" alt="${esc(issuerName)}" height="44" style="display:block;max-height:44px"/>`
        : `<div style="font-size:20px;font-weight:800;color:#1a1a2e">${esc(issuerName)}</div>`,
      `</td></tr>`,
      // Card
      `<tr><td style="padding:0 16px 20px">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px">`,
      `<tr><td align="center" style="padding:32px 32px 24px">`,
      `<div style="font-size:48px;margin-bottom:10px">&#9989;</div>`,
      `<h2 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#1a1a2e">Quote Accepted</h2>`,
      `<p style="margin:0;font-size:14px;color:#6b7280">Thank you &#8212; we&#8217;ve received your acceptance of quote <strong>${esc(q.quote_number || '')}</strong></p>`,
      `</td></tr>`,
      `<tr><td style="padding:0 32px 28px">`,
      `<div style="background:#f8f9fc;border-radius:8px;padding:16px">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0">`,
      q.title ? row('Title', esc(q.title)) : '',
      `<tr><td style="padding:8px 0;font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb">Total</td>`,
      `<td style="padding:8px 0;font-size:18px;font-weight:800;color:#1a1a2e;text-align:right;border-top:1px solid #e5e7eb">&#163;${total.toFixed(2)}</td></tr>`,
      `</table></div>`,
      `<p style="font-size:13px;color:#374151;line-height:1.6;margin:16px 0">`,
      `A member of the ${esc(issuerName)} team will be in touch shortly. If you have any questions, please don&#8217;t hesitate to get in touch.`,
      `</p>`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">`,
      `<div style="display:inline-block;background:${primaryColor};color:#ffffff;padding:5px 18px;border-radius:20px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px">`,
      `Accepted ${acceptedFormatted}`,
      `</div></td></tr></table>`,
      `</td></tr></table></td></tr>`,
      // Footer
      `<tr><td align="center" style="padding:0 16px 32px;font-size:11px;color:#9ca3af">`,
      `Confirmation from ${esc(issuerName)}.`,
      `</td></tr>`,
      `</table></td></tr></table></body></html>`,
    ].join('\n');

    // Send emails if Resend is configured
    if (env.RESEND_API_KEY) {
      const batch = [];

      // Notify all staff
      for (const s of staff) {
        if (!s.email) continue;
        batch.push({
          from: `${issuerName} CRM <noreply@smartcoretechnology.co.uk>`,
          to: [s.email],
          subject: `✅ Quote ${q.quote_number || ''} accepted by ${coName || 'a customer'}`,
          html: staffHtml,
        });
      }

      // Confirm to customer
      if (q.contact_email) {
        batch.push({
          from: `${issuerName} <noreply@smartcoretechnology.co.uk>`,
          to: [q.contact_email],
          subject: `Your quote confirmation — ${q.quote_number || ''}`,
          html: customerHtml,
        });
      }

      if (batch.length > 0) {
        // Send in chunks of 10 to stay within Resend batch limits
        for (let i = 0; i < batch.length; i += 10) {
          await fetch('https://api.resend.com/emails/batch', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(batch.slice(i, i + 10)),
          });
        }
      }
    }

    return json({ ok: true, accepted_at: acceptedAt });

  } catch (err) {
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}

function row(label, value) {
  return [
    `<tr>`,
    `<td style="padding:10px 0;font-size:13px;color:#6b7280;width:140px;border-bottom:1px solid #f3f4f6">${label}</td>`,
    `<td style="padding:10px 0;font-size:13px;font-weight:600;color:#1a1a2e;border-bottom:1px solid #f3f4f6">${value}</td>`,
    `</tr>`,
  ].join('');
}
