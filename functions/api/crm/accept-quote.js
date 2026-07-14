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

    // Fetch branding + company name in parallel
    const reqs = [
      fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${encodeURIComponent(q.tenant_id)}&select=branding&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }),
    ];
    if (q.crm_company_id) {
      reqs.push(fetch(`${SUPABASE_URL}/rest/v1/crm_companies?id=eq.${q.crm_company_id}&select=name&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }));
    }
    const [bRes, cRes] = await Promise.all(reqs);
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
        pricing_display: q.pricing_display || 'itemised',
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
    const { token, signer_name, signature_data } = body || {};
    if (!token) return json({ error: 'Token required' }, 400);

    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '';
    const acceptedAt = new Date().toISOString();

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
    if (q.status === 'expired')  return json({ error: 'This quote has expired and cannot be accepted' }, 409);

    const tenantId = q.tenant_id;

    // Upload signature to Storage so email clients (Gmail) can load it via https://
    let signatureUrl = null;
    if (signature_data && signature_data.startsWith('data:image/png;base64,')) {
      signatureUrl = await uploadSignature(signature_data, q.id, SERVICE_KEY);
    }

    // Mark accepted + save signature
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
          signature_data: signature_data || null,
          signed_by_name: signer_name || null,
        }),
      }
    );
    if (!patchRes.ok) {
      const t = await patchRes.text().catch(() => '');
      return json({ error: `Failed to save acceptance: ${t}` }, 500);
    }

    // ── Fire CRM commands (quote_accepted trigger) ───────────
    // Run async — don't let a command failure block the acceptance response
    const cmdCtx = {
      quote_id:      q.id,
      quote_title:   q.title || '',
      quote_number:  q.quote_number || '',
      quote_amount:  q.total ? `£${Number(q.total).toFixed(2)}` : '',
      contact_name:  signer_name || '',
      contact_email: q.contact_email || '',
      company_id:    q.crm_company_id || '',
      lead_id:       q.crm_lead_id || '',
    };
    fetch('https://smartcoretechnology.co.uk/api/crm/commands-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
      body: JSON.stringify({ tenant_id: tenantId, trigger_type: 'quote_accepted', ctx: cmdCtx }),
    }).catch(() => {});

    // ── Collect the 3 assignees ──────────────────────────────
    // We need: (1) quote.assigned_to, (2) lead.assigned_to, (3) company.assigned_to
    // All are employee UUIDs in core_employees.id

    const assigneeIds = new Set();
    if (q.assigned_to) assigneeIds.add(q.assigned_to);

    const sideReqs = [];
    // Lead assignee
    if (q.crm_lead_id) {
      sideReqs.push(
        fetch(`${SUPABASE_URL}/rest/v1/crm_leads?id=eq.${q.crm_lead_id}&select=assigned_to&limit=1`,
          { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
          .then(r => r.json())
          .then(d => { const row = Array.isArray(d) ? d[0] : null; if (row?.assigned_to) assigneeIds.add(row.assigned_to); })
      );
    }
    // Company assignee
    if (q.crm_company_id) {
      sideReqs.push(
        fetch(`${SUPABASE_URL}/rest/v1/crm_companies?id=eq.${q.crm_company_id}&select=assigned_to,name&limit=1`,
          { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } })
          .then(r => r.json())
          .then(d => {
            const row = Array.isArray(d) ? d[0] : null;
            if (row?.assigned_to) assigneeIds.add(row.assigned_to);
          })
      );
    }

    // Fetch branding + company name + lead + company in parallel
    const [bData, , coData] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${encodeURIComponent(tenantId)}&select=branding&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }).then(r => r.json()),
      Promise.all(sideReqs),
      q.crm_company_id
        ? fetch(`${SUPABASE_URL}/rest/v1/crm_companies?id=eq.${q.crm_company_id}&select=name&limit=1`,
            { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }).then(r => r.json())
        : Promise.resolve([]),
    ]);

    const branding    = (Array.isArray(bData) ? bData[0]?.branding : null) || {};
    const coName      = (Array.isArray(coData) ? coData[0]?.name : null) || '';
    const issuerName  = branding.company_name   || 'SmartCore Technology';
    const primaryColor = branding.primary_color || '#1e5cff';
    const secondaryColor = branding.secondary_color || '#0a0f1e';
    const logoUrl = branding.prefer_icon
      ? (branding.icon_url || branding.logo_url)
      : (branding.logo_url || branding.icon_url);

    // Resolve assignee emails from core_employees
    const staffEmails = [];
    if (assigneeIds.size > 0) {
      const idList = [...assigneeIds].map(id => `id=eq.${id}`).join('&or=');
      const empRes = await fetch(
        `${SUPABASE_URL}/rest/v1/core_employees?or=(${[...assigneeIds].map(id => `id.eq.${id}`).join(',')})&select=id,full_name,work_email&limit=20`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      const empData = await empRes.json();
      if (Array.isArray(empData)) {
        const seen = new Set();
        for (const e of empData) {
          if (e.work_email && !seen.has(e.work_email)) {
            seen.add(e.work_email);
            staffEmails.push({ email: e.work_email, name: e.full_name || e.work_email });
          }
        }
      }
    }

    if (!env.RESEND_API_KEY || staffEmails.length === 0 && !q.contact_email) {
      return json({ ok: true, accepted_at: acceptedAt });
    }

    const acceptedFormatted = new Date(acceptedAt).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    const total = Number(q.total || 0);

    // Use hosted URL for signature (data: URIs are blocked by Gmail)
    const sigImgSrc = signatureUrl || signature_data || null;
    const sigBlock = sigImgSrc
      ? `<tr><td style="padding:16px 0 0">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;font-weight:700;margin-bottom:8px">Electronic Signature</div>
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#f8f9fc;display:inline-block">
            <img src="${esc(sigImgSrc)}" alt="Signature" style="max-width:280px;max-height:90px;display:block"/>
          </div>
          <div style="margin-top:6px;font-size:11px;color:#9ca3af">Signed by ${esc(signer_name || 'customer')} &middot; ${acceptedFormatted}</div>
        </td></tr>`
      : '';

    // Staff notification email
    const staffHtml = [
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>',
      `<title>Quote ${esc(q.quote_number || '')} Accepted</title></head>`,
      `<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:24px 0">`,
      `<tr><td align="center"><table width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%">`,

      // Logo
      `<tr><td align="center" style="padding:0 16px 20px">`,
      logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(issuerName)}" height="44" style="display:block;max-height:44px"/>` : `<div style="font-size:20px;font-weight:800;color:#1a1a2e">${esc(issuerName)}</div>`,
      `</td></tr>`,

      // Green accepted banner
      `<tr><td style="padding:0 16px 20px">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#10b981,#059669);border-radius:12px">`,
      `<tr><td align="center" style="padding:28px 32px">`,
      `<div style="font-size:40px;margin-bottom:8px">&#9989;</div>`,
      `<h2 style="margin:0 0 6px;color:#ffffff;font-size:22px;font-weight:800">Quote Accepted!</h2>`,
      `<p style="margin:0;color:rgba(255,255,255,.85);font-size:14px">${esc(coName || 'A customer')} has accepted quote <strong>${esc(q.quote_number || '')}</strong></p>`,
      `</td></tr></table></td></tr>`,

      // Details card
      `<tr><td style="padding:0 16px 20px">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px">`,
      `<tr><td style="padding:28px 32px">`,
      `<h3 style="margin:0 0 16px;font-size:16px;font-weight:700;color:#1a1a2e">Quote Details</h3>`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0">`,
      detailRow('Quote Reference', esc(q.quote_number || '')),
      q.title ? detailRow('Title', esc(q.title)) : '',
      detailRow('Company', esc(coName || '—')),
      `<tr><td style="padding:10px 0;font-size:13px;color:#6b7280;width:140px;border-bottom:1px solid #f3f4f6">Total Value</td>`,
      `<td style="padding:10px 0;font-size:16px;font-weight:800;color:#10b981;border-bottom:1px solid #f3f4f6">&#163;${total.toFixed(2)}</td></tr>`,
      detailRow('Accepted By', signer_name ? esc(signer_name) : `Contact at ${esc(coName || '—')}`),
      detailRow('Accepted At', acceptedFormatted),
      sigBlock,
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
      `<tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">`,

      // Logo
      `<tr><td align="center" style="padding:0 16px 20px">`,
      logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(issuerName)}" height="44" style="display:block;max-height:44px"/>` : `<div style="font-size:20px;font-weight:800;color:#1a1a2e">${esc(issuerName)}</div>`,
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
      `<div style="background:#f8f9fc;border-radius:8px;padding:16px;margin-bottom:16px">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0">`,
      q.title ? detailRow('Title', esc(q.title)) : '',
      `<tr><td style="padding:8px 0;font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb">Total</td>`,
      `<td style="padding:8px 0;font-size:18px;font-weight:800;color:#1a1a2e;text-align:right;border-top:1px solid #e5e7eb">&#163;${total.toFixed(2)}</td></tr>`,
      `</table></div>`,
      sigImgSrc ? `<div style="margin-bottom:16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;font-weight:700;margin-bottom:8px">Your Signature on File</div>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 14px;background:#f8f9fc;display:inline-block">
          <img src="${esc(sigImgSrc)}" alt="Your signature" style="max-width:240px;max-height:80px;display:block"/>
        </div>
      </div>` : '',
      `<p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 20px">`,
      `A member of the ${esc(issuerName)} team will be in touch shortly. If you have any questions, please don&#8217;t hesitate to get in touch.`,
      `</p>`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">`,
      `<div style="display:inline-block;background:${primaryColor};color:#ffffff;padding:5px 18px;border-radius:20px;font-size:12px;font-weight:700;letter-spacing:.5px">`,
      `Accepted ${acceptedFormatted}`,
      `</div></td></tr></table>`,
      `</td></tr></table></td></tr>`,

      // Footer
      `<tr><td align="center" style="padding:0 16px 32px;font-size:11px;color:#9ca3af">`,
      `Confirmation from ${esc(issuerName)}.`,
      `</td></tr>`,

      `</table></td></tr></table></body></html>`,
    ].join('\n');

    // Build email batch
    const batch = [];

    for (const s of staffEmails) {
      batch.push({
        from: `${issuerName} CRM <noreply@smartcoretechnology.co.uk>`,
        to: [s.email],
        subject: `✅ Quote ${q.quote_number || ''} accepted by ${coName || 'a customer'}`,
        html: staffHtml,
      });
    }

    if (q.contact_email) {
      batch.push({
        from: `${issuerName} <noreply@smartcoretechnology.co.uk>`,
        to: [q.contact_email],
        subject: `Your quote confirmation — ${q.quote_number || ''}`,
        html: customerHtml,
      });
    }

    if (batch.length > 0 && env.RESEND_API_KEY) {
      for (let i = 0; i < batch.length; i += 10) {
        await fetch('https://api.resend.com/emails/batch', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(batch.slice(i, i + 10)),
        });
      }
    }

    return json({ ok: true, accepted_at: acceptedAt });

  } catch (err) {
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}

async function uploadSignature(dataUri, quoteId, serviceKey) {
  try {
    const base64 = dataUri.split(',')[1];
    if (!base64) return null;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const path = `quotes/${quoteId}.png`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/signatures/${path}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: bytes,
    });
    if (!res.ok) return null;
    return `${SUPABASE_URL}/storage/v1/object/public/signatures/${path}`;
  } catch (_) {
    return null;
  }
}

function detailRow(label, value) {
  return [
    `<tr>`,
    `<td style="padding:10px 0;font-size:13px;color:#6b7280;width:140px;border-bottom:1px solid #f3f4f6">${label}</td>`,
    `<td style="padding:10px 0;font-size:13px;font-weight:600;color:#1a1a2e;border-bottom:1px solid #f3f4f6">${value}</td>`,
    `</tr>`,
  ].join('');
}
