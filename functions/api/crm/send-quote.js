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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function onRequestPost({ request, env }) {
  try {
    const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

    const authHeader = (request.headers.get('Authorization') || '').replace('Bearer ', '');
    if (!authHeader) return json({ error: 'Unauthorised' }, 401);
    if (!env.RESEND_API_KEY) return json({ error: 'Email sending not configured on this server' }, 500);

    // Parse body first — body can only be read once in Workers
    let body;
    try { body = await request.json(); } catch (_) { return json({ error: 'Invalid request body' }, 400); }
    const { quote_id, contact_email, recipient_name } = body || {};

    if (!quote_id)      return json({ error: 'quote_id is required' }, 400);
    if (!contact_email) return json({ error: 'contact_email is required' }, 400);

    // Verify the auth token
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${authHeader}` },
    });
    if (!userRes.ok) return json({ error: 'Unauthorised' }, 401);
    const { id: authUserId } = await userRes.json();

    // Get tenant
    const empRes = await fetch(
      `${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${authUserId}&select=company_id&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const empData = await empRes.json();
    const emp = Array.isArray(empData) ? empData[0] : null;
    if (!emp) return json({ error: 'Employee not found' }, 403);
    const tenantId = emp.company_id;

    // Fetch quote + branding in parallel (no join — avoids PostgREST foreign key issues)
    const [qRes, bRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/crm_quotes?id=eq.${quote_id}&tenant_id=eq.${encodeURIComponent(tenantId)}&select=*&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }),
      fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${encodeURIComponent(tenantId)}&select=branding&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }),
    ]);

    const qData = await qRes.json();
    const q = Array.isArray(qData) ? qData[0] : null;
    if (!q) return json({ error: 'Quote not found' }, 404);

    const bData = await bRes.json();
    const branding = (Array.isArray(bData) ? bData[0]?.branding : null) || {};

    // Fetch company name separately
    let coName = '';
    if (q.crm_company_id) {
      const cRes = await fetch(
        `${SUPABASE_URL}/rest/v1/crm_companies?id=eq.${q.crm_company_id}&select=name&limit=1`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
      );
      const cData = await cRes.json();
      coName = (Array.isArray(cData) ? cData[0]?.name : null) || '';
    }

    const issuerName    = branding.company_name    || 'SmartCore Technology';
    const primaryColor  = branding.primary_color   || '#1e5cff';
    const secondaryColor = branding.secondary_color || '#0a0f1e';
    const logoUrl = branding.prefer_icon
      ? (branding.icon_url || branding.logo_url)
      : (branding.logo_url || branding.icon_url);

    const acceptanceToken = crypto.randomUUID();
    const origin    = new URL(request.url).origin;
    const acceptUrl = `${origin}/systems/crm/quote-accept.html?token=${acceptanceToken}`;

    const sub   = Number(q.subtotal || 0);
    const disc  = Number(q.discount_amount || 0);
    const total = sub > 0 ? Math.max(0, sub - disc) : Number(q.total || 0);
    const expiryStr = q.expiry_date
      ? new Date(q.expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;

    // Build table-based email HTML (safe for all email clients)
    const pd = q.pricing_display || 'itemised';
    const lineRows = pd === 'total_only' ? '' : (q.line_items || []).map(li => {
      const lineTotal = Number(li.total || ((li.qty || 1) * (li.unit_price || 0)));
      if (pd === 'desc_only') {
        return `<tr><td colspan="4" style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151">${esc(li.description || '')}</td></tr>`;
      }
      return `<tr>
        <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151">${esc(li.description || '')}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:center;color:#374151">${li.qty || 1}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;color:#374151">&#163;${Number(li.unit_price || 0).toFixed(2)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;font-weight:600;color:#1a1a2e">&#163;${lineTotal.toFixed(2)}</td>
      </tr>`;
    }).join('');

    const emailSubject = `Quote ${q.quote_number || ''} from ${issuerName}${q.title ? ' — ' + q.title : ''}`;

    const emailHtml = [
      '<!DOCTYPE html>',
      '<html lang="en"><head>',
      '<meta charset="utf-8"/>',
      '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
      `<title>${esc(emailSubject)}</title>`,
      '</head>',
      `<body style="margin:0;padding:0;background:${secondaryColor};font-family:Arial,Helvetica,sans-serif">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${secondaryColor};padding:24px 0">`,
      `<tr><td align="center">`,
      `<table width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%">`,

      // Logo row
      `<tr><td align="center" style="padding:0 16px 20px">`,
      logoUrl
        ? `<img src="${esc(logoUrl)}" alt="${esc(issuerName)}" height="44" style="display:block;max-height:44px"/>`
        : `<div style="font-size:20px;font-weight:800;color:#ffffff">${esc(issuerName)}</div>`,
      `</td></tr>`,

      // Intro card
      `<tr><td style="padding:0 16px 20px">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px">`,
      `<tr><td style="padding:28px 32px">`,
      `<h1 style="margin:0 0 6px;font-size:20px;font-weight:800;color:#1a1a2e">You have a new quote</h1>`,
      `<p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.7">`,
      `Hi ${esc(recipient_name || coName || 'there')},<br/><br/>`,
      `${esc(issuerName)} has prepared a quote for you. Click the button below to review the full details and sign it online.`,
      `</p>`,

      // Stats table
      `<table width="100%" cellpadding="0" cellspacing="0" border="0">`,
      `<tr>`,
      `<td width="48%" style="background:#f8f9fc;border-radius:8px;padding:14px 16px">`,
      `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;font-weight:700;margin-bottom:4px">Quote Reference</div>`,
      `<div style="font-size:18px;font-weight:800;color:#1a1a2e">${esc(q.quote_number || '')}</div>`,
      `</td>`,
      `<td width="4%"></td>`,
      `<td width="48%" style="background:#f8f9fc;border-radius:8px;padding:14px 16px">`,
      `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;font-weight:700;margin-bottom:4px">Total Value</div>`,
      `<div style="font-size:18px;font-weight:800;color:#1a1a2e">&#163;${total.toFixed(2)}</div>`,
      `</td>`,
      `</tr>`,
      expiryStr ? [
        `<tr><td colspan="3" style="padding-top:12px">`,
        `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:11px 14px;font-size:12px;font-weight:700;color:#9a3412">`,
        `&#9200; This quote is valid until ${esc(expiryStr)}`,
        `</div></td></tr>`,
      ].join('') : '',
      `</table>`,

      // CTA button
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px">`,
      `<tr><td align="center">`,
      `<a href="${acceptUrl}" style="display:inline-block;background:${primaryColor};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:15px 48px;border-radius:8px">`,
      `Review &amp; Sign Quote &#8594;`,
      `</a>`,
      `</td></tr>`,
      `<tr><td align="center" style="padding-top:10px;font-size:11px;color:#9ca3af">`,
      `Or paste this link in your browser:<br/>`,
      `<a href="${acceptUrl}" style="color:${primaryColor};word-break:break-all;font-size:11px">${acceptUrl}</a>`,
      `</td></tr>`,
      `</table>`,
      `</td></tr></table>`,
      `</td></tr>`,

      // Quote summary card
      `<tr><td style="padding:0 16px 20px">`,
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:12px;overflow:hidden">`,
      // Dark header
      `<tr><td style="background:${secondaryColor};padding:22px 28px">`,
      `<div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;color:rgba(255,255,255,.55);margin-bottom:4px">Quote Summary</div>`,
      `<div style="font-size:22px;font-weight:900;color:#ffffff">${esc(q.quote_number || '')}</div>`,
      q.title ? `<div style="font-size:13px;color:rgba(255,255,255,.7);margin-top:2px">${esc(q.title)}</div>` : '',
      `</td></tr>`,
      // Line items
      `<tr><td style="padding:20px 28px">`,
      pd !== 'total_only' ? [
        `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">`,
        `<tr style="background:${primaryColor}">`,
        `<th style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#ffffff;text-align:left">Description</th>`,
        pd === 'itemised' ? `<th style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#ffffff;text-align:center;width:48px">Qty</th>` : '',
        pd === 'itemised' ? `<th style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#ffffff;text-align:right;width:88px">Unit</th>` : '',
        pd === 'itemised' ? `<th style="padding:9px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#ffffff;text-align:right;width:88px">Total</th>` : '',
        `</tr>`,
        lineRows || `<tr><td colspan="${pd === 'itemised' ? 4 : 1}" style="padding:14px;text-align:center;color:#9ca3af;font-size:13px">No line items</td></tr>`,
        `</table>`,
      ].join('') : '',
      // Totals
      `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px">`,
      `<tr><td align="right">`,
      `<table cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;min-width:230px">`,
      pd === 'itemised' ? `<tr><td style="padding:9px 16px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151"><span>Subtotal</span><span style="float:right">&#163;${(sub || total).toFixed(2)}</span></td></tr>` : '',
      pd === 'itemised' && disc > 0 ? `<tr><td style="padding:9px 16px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#374151"><span>Discount</span><span style="float:right">-&#163;${disc.toFixed(2)}</span></td></tr>` : '',
      `<tr><td style="padding:11px 16px;background:${primaryColor};color:#ffffff;font-weight:800;font-size:15px">`,
      `<span>TOTAL</span><span style="float:right">&#163;${total.toFixed(2)}</span>`,
      `</td></tr>`,
      `</table></td></tr></table>`,
      // Notes + Terms
      q.notes ? `<div style="margin-top:16px;background:#f8f9fc;border-radius:8px;padding:14px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;font-weight:700;margin-bottom:5px">Notes</div><div style="font-size:13px;color:#374151;line-height:1.6;white-space:pre-wrap">${esc(q.notes)}</div></div>` : '',
      `<div style="margin-top:12px;background:#f8f9fc;border-radius:8px;padding:14px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af;font-weight:700;margin-bottom:5px">Terms &amp; Conditions</div><div style="font-size:13px;color:#374151;line-height:1.6;white-space:pre-wrap">${esc(q.terms || 'Payment due within 30 days.')}</div></div>`,
      `</td></tr>`,
      `</table></td></tr>`,

      // Footer
      `<tr><td align="center" style="padding:0 16px 32px;font-size:11px;color:#9ca3af">`,
      `This email was sent by ${esc(issuerName)}. Quote ${esc(q.quote_number || '')}.`,
      `</td></tr>`,

      `</table></td></tr></table>`,
      `</body></html>`,
    ].join('\n');

    // Send via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${issuerName} <noreply@smartcoretechnology.co.uk>`,
        to: [contact_email],
        subject: emailSubject,
        html: emailHtml,
      }),
    });

    if (!emailRes.ok) {
      let errMsg = `HTTP ${emailRes.status}`;
      try {
        const errBody = await emailRes.json();
        errMsg = errBody.message || errBody.error || JSON.stringify(errBody);
      } catch (_) {}
      return json({ error: `Email delivery failed: ${errMsg}` }, 500);
    }

    // Persist token + status on quote
    await fetch(
      `${SUPABASE_URL}/rest/v1/crm_quotes?id=eq.${quote_id}&tenant_id=eq.${encodeURIComponent(tenantId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          acceptance_token: acceptanceToken,
          contact_email,
          sent_at: new Date().toISOString(),
          status: 'sent',
        }),
      }
    );

    return json({ ok: true });

  } catch (err) {
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}
