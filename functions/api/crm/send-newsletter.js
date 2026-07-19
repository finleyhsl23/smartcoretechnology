const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const MONTHLY_LIMITS = { professional: 50, business: 250, enterprise: 500 };

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: CORS });

  // Verify auth
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: CORS });
  const { id: authUserId } = await userRes.json();

  // Get tenant_id
  const empRes = await fetch(`${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${authUserId}&select=company_id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [emp] = await empRes.json();
  if (!emp) return new Response(JSON.stringify({ error: 'Employee not found' }), { status: 403, headers: CORS });
  const tenantId = emp.company_id;

  // Get tier
  const modRes = await fetch(`${SUPABASE_URL}/rest/v1/company_modules?company_id=eq.${encodeURIComponent(tenantId)}&module_key=eq.smartcore-crm&select=tier&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [mod] = await modRes.json();
  const tier = mod?.tier || 'lite';
  const monthlyLimit = MONTHLY_LIMITS[tier] ?? 0;

  if (!monthlyLimit) {
    return new Response(JSON.stringify({ error: 'Newsletter is not available on your current plan.' }), { status: 403, headers: CORS });
  }

  // Check current month usage
  const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const usageRes = await fetch(
    `${SUPABASE_URL}/rest/v1/crm_newsletter_usage?tenant_id=eq.${encodeURIComponent(tenantId)}&month=eq.${currentMonth}&select=sent_count&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const [usageRow] = await usageRes.json();
  const currentUsage = usageRow?.sent_count || 0;

  const remaining = monthlyLimit - currentUsage;
  if (remaining <= 0) {
    return new Response(JSON.stringify({
      error: `Monthly email limit reached (${monthlyLimit} emails/month on ${tier} plan). Resets on the 1st of next month.`,
      limit: monthlyLimit, used: currentUsage, sent: 0, failed: 0,
    }), { status: 429, headers: CORS });
  }

  const { subject, body, recipient_type, company_ids, contact_ids } = await request.json();
  if (!subject || !body) return new Response(JSON.stringify({ error: 'Subject and body are required' }), { status: 400, headers: CORS });

  // Fetch branding
  let branding = {};
  try {
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${encodeURIComponent(tenantId)}&select=branding&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const [bRow] = await bRes.json();
    branding = bRow?.branding || {};
  } catch (_) {}

  const companyName  = branding.company_name || 'SmartCore Technology';
  const primaryColor = branding.primary_color || '#1e5cff';
  const textColor    = branding.text_color    || '#374151';
  const logoUrl      = branding.prefer_icon ? (branding.icon_url || branding.logo_url) : (branding.logo_url || branding.icon_url);

  // Collect recipients
  const recipients = [];

  async function fetchCompanyMap() {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_companies?tenant_id=eq.${encodeURIComponent(tenantId)}&select=id,name&limit=500`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const rows = await r.json();
    return Object.fromEntries((rows || []).map(c => [c.id, c.name]));
  }

  if (recipient_type === 'all_contacts' || recipient_type === 'contacts' || recipient_type === 'both') {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_contacts?tenant_id=eq.${encodeURIComponent(tenantId)}&email=not.is.null&email=neq.&select=first_name,last_name,email,crm_company_id&limit=2000`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const contacts = await r.json();
    const compMap = await fetchCompanyMap();
    for (const c of contacts || []) {
      if (!c.email) continue;
      recipients.push({
        email: c.email,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
        first_name: c.first_name || '',
        company: c.crm_company_id ? (compMap[c.crm_company_id] || '') : '',
      });
    }
  }

  if (recipient_type === 'portal_users' || recipient_type === 'both') {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_portal_users?tenant_id=eq.${encodeURIComponent(tenantId)}&status=eq.active&select=name,email,crm_company_id&limit=2000`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const users = await r.json();
    const compMap = await fetchCompanyMap();
    for (const u of users || []) {
      if (!u.email) continue;
      const parts = (u.name || '').split(' ');
      recipients.push({
        email: u.email,
        name: u.name || u.email,
        first_name: parts[0] || '',
        company: u.crm_company_id ? (compMap[u.crm_company_id] || '') : '',
      });
    }
  }

  if (recipient_type === 'by_company' && Array.isArray(company_ids) && company_ids.length) {
    const inFilter = `crm_company_id=in.(${company_ids.map(id => encodeURIComponent(id)).join(',')})`;
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_contacts?tenant_id=eq.${encodeURIComponent(tenantId)}&email=not.is.null&email=neq.&${inFilter}&select=first_name,last_name,email,crm_company_id&limit=2000`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const contacts = await r.json();
    const compMap = await fetchCompanyMap();
    for (const c of contacts || []) {
      if (!c.email) continue;
      recipients.push({
        email: c.email,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
        first_name: c.first_name || '',
        company: c.crm_company_id ? (compMap[c.crm_company_id] || '') : '',
      });
    }
  }

  if (recipient_type === 'select_contacts' && Array.isArray(contact_ids) && contact_ids.length) {
    const inFilter = `id=in.(${contact_ids.map(id => encodeURIComponent(id)).join(',')})`;
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_contacts?tenant_id=eq.${encodeURIComponent(tenantId)}&${inFilter}&select=first_name,last_name,email,crm_company_id&limit=2000`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const contacts = await r.json();
    const compMap = await fetchCompanyMap();
    for (const c of contacts || []) {
      if (!c.email) continue;
      recipients.push({
        email: c.email,
        name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email,
        first_name: c.first_name || '',
        company: c.crm_company_id ? (compMap[c.crm_company_id] || '') : '',
      });
    }
  }

  if (!recipients.length) {
    return new Response(JSON.stringify({ error: 'No valid recipients found', sent: 0, failed: 0 }), { status: 400, headers: CORS });
  }

  // Cap to remaining quota
  const cappedRecipients = recipients.slice(0, remaining);
  const capped = cappedRecipients.length < recipients.length;

  if (!env.RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'Email sending not configured (RESEND_API_KEY missing)', sent: 0, failed: 0 }), { status: 500, headers: CORS });
  }

  function fillVars(text, r) {
    return text
      .replace(/\{\{name\}\}/g, r.name)
      .replace(/\{\{first_name\}\}/g, r.first_name)
      .replace(/\{\{company\}\}/g, r.company)
      .replace(/\{\{your_company\}\}/g, companyName);
  }

  function buildHtml(r) {
    const filledSubject = fillVars(subject, r);
    const filledBody    = fillVars(body, r);
    const bodyHtml = filledBody
      .split(/\n{2,}/)
      .map(p => `<p style="margin:0 0 18px;font-size:15px;color:${textColor};line-height:1.7">${p.replace(/\n/g,'<br>')}</p>`)
      .join('');

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f0f4ff;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4ff;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:560px;width:100%">
        <tr>
          <td style="background:${primaryColor};padding:26px 36px;text-align:center">
            ${logoUrl
              ? `<img src="${logoUrl}" alt="${companyName}" style="max-height:50px;max-width:200px;object-fit:contain;display:block;margin:0 auto"/>`
              : `<div style="font-size:22px;font-weight:800;color:#ffffff">${companyName}</div>`
            }
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 28px;color:${textColor}">
            ${filledSubject ? `<h1 style="margin:0 0 22px;font-size:22px;font-weight:800;color:#0a0f2e;line-height:1.25">${filledSubject}</h1>` : ''}
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="background:#f8f9fc;border-top:1px solid #e5e7eb;padding:18px 36px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af">${companyName} · Powered by <a href="https://smartcoretechnology.co.uk" style="color:${primaryColor};text-decoration:none">SmartCore</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  // Send in batches of 100 (Resend limit)
  let sent = 0, failed = 0;
  const BATCH = 100;

  for (let i = 0; i < cappedRecipients.length; i += BATCH) {
    const batch = cappedRecipients.slice(i, i + BATCH).map(r => ({
      from: `${companyName} <noreply@smartcoretechnology.co.uk>`,
      to: [r.email],
      subject: fillVars(subject, r),
      html: buildHtml(r),
    }));

    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      const json = await res.json();
      if (res.ok && Array.isArray(json.data)) {
        sent += json.data.length;
      } else {
        failed += batch.length;
      }
    } catch {
      failed += batch.length;
    }
  }

  // Update monthly usage counter
  if (sent > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/crm_newsletter_usage`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        month: currentMonth,
        sent_count: currentUsage + sent,
      }),
    });
  }

  return new Response(JSON.stringify({
    success: true, sent, failed, total: recipients.length,
    limit: monthlyLimit, used: currentUsage + sent,
    capped: capped ? recipients.length - cappedRecipients.length : 0,
  }), { status: 200, headers: CORS });
}
