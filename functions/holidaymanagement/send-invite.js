const SCHEMA = 'holidaymanagement';

function db(supabaseUrl, serviceKey) {
  const base = `${supabaseUrl}/rest/v1`;
  const h = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Accept-Profile': SCHEMA,
    'Content-Profile': SCHEMA,
    'Prefer': 'return=representation'
  };

  return {
    async insert(table, data) {
      const res = await fetch(`${base}/${table}`, {
        method: 'POST', headers: h,
        body: JSON.stringify(Array.isArray(data) ? data : [data])
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return text ? JSON.parse(text) : [];
    },
    async select(table, query = '') {
      const res = await fetch(`${base}/${table}?${query}`, { headers: h });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return JSON.parse(text);
    }
  };
}

export async function onRequestPost({ request, env }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !RESEND_API_KEY) {
    return new Response('Missing environment variables', { status: 500 });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { company_id, company_name, invite_type, full_name, email, role, department, job_title, annual_leave_allowance } = body;
  if (!company_id || !email || !invite_type) return new Response('Missing required fields', { status: 400 });

  const client = db(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const token = crypto.randomUUID();
  const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    await client.insert('onboarding_invites', {
      company_id, token, email, invite_type,
      full_name: full_name || null,
      role: role || 'employee',
      expires_at
    });
  } catch (err) {
    return new Response('Failed to create invite: ' + err.message, { status: 500 });
  }

  // Create employee stub (ignore duplicate errors)
  try {
    await client.insert('employees', {
      company_id, email,
      full_name: full_name || null,
      role: role || 'employee',
      department: department || null,
      job_title: job_title || null,
      annual_leave_allowance: annual_leave_allowance ?? 28,
      status: 'invited'
    });
  } catch (err) {
    if (!err.message.includes('duplicate') && !err.message.includes('23505')) {
      console.error('Employee stub error:', err.message);
    }
  }

  const inviteUrl = `https://smartcoretechnology.co.uk/holidaymanagement/onboarding.html?token=${token}`;
  const isOwner = invite_type === 'owner';

  const emailHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="font-family:Inter,sans-serif;background:#07111f;color:#f4f7fb;margin:0;padding:40px 20px">
  <div style="max-width:520px;margin:0 auto;background:rgba(12,25,45,0.9);border:1px solid rgba(120,160,255,0.18);border-radius:20px;padding:36px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
      <div style="width:40px;height:40px;background:#2d7cff;border-radius:10px;text-align:center;line-height:40px;font-size:18px">📅</div>
      <div>
        <div style="font-weight:700">SmartCore Technology</div>
        <div style="font-size:11px;color:#9fb1c9;text-transform:uppercase;letter-spacing:.08em">Holiday Management</div>
      </div>
    </div>
    <h1 style="margin:0 0 8px;font-size:1.4rem">${isOwner ? "Set up your company account" : `You're invited to join ${company_name || 'your company'}`}</h1>
    <p style="color:#9fb1c9;margin:0 0 24px">${full_name ? `Hi ${full_name},` : 'Hi,'} ${isOwner ? 'SmartCore Technology has created a holiday management account for your company.' : `${company_name || 'Your company'} uses SmartCore Holiday Management for leave requests.`}</p>
    <a href="${inviteUrl}" style="display:inline-block;background:linear-gradient(180deg,#2d7cff,#1d5ed8);color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700">${isOwner ? 'Set Up Your Company' : 'Accept Invitation'}</a>
    <p style="color:#9fb1c9;font-size:.85rem;margin-top:24px">This link expires in 7 days. If you did not expect this email, you can safely ignore it.</p>
  </div>
</body></html>`;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'SmartCore Technology <noreply@smartcoretechnology.co.uk>',
      to: [email],
      subject: isOwner ? `Set up your Holiday Management account — ${company_name || 'SmartCore'}` : `You're invited to ${company_name || 'Holiday Management'}`,
      html: emailHtml
    })
  });

  if (!resendRes.ok) return new Response('Email send failed: ' + await resendRes.text(), { status: 500 });

  return Response.json({ success: true, token });
}
