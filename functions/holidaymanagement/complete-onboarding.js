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
    async select(table, query = '') {
      const res = await fetch(`${base}/${table}?${query}`, { headers: h });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return JSON.parse(text);
    },
    async update(table, query, data) {
      const res = await fetch(`${base}/${table}?${query}`, {
        method: 'PATCH', headers: h,
        body: JSON.stringify(data)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return text ? JSON.parse(text) : [];
    }
  };
}

export async function onRequestPost({ request, env }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return new Response('Missing environment variables', { status: 500 });

  let body;
  try { body = await request.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { token, user_id, full_name, phone, date_of_birth, start_date, emergency_contact_name, emergency_contact_phone } = body;
  if (!token || !user_id) return new Response('token and user_id are required', { status: 400 });

  const client = db(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Verify token
  const invites = await client.select('onboarding_invites', `token=eq.${token}&used_at=is.null`);
  const invite = invites?.[0];

  if (!invite) return new Response('Invalid or expired invite token', { status: 400 });
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return new Response('Invite token has expired', { status: 400 });
  }

  // Update employee record
  await client.update(
    'employees',
    `company_id=eq.${invite.company_id}&email=eq.${encodeURIComponent(invite.email)}`,
    {
      user_id,
      full_name: full_name || invite.full_name || null,
      phone: phone || null,
      date_of_birth: date_of_birth || null,
      start_date: start_date || null,
      emergency_contact_name: emergency_contact_name || null,
      emergency_contact_phone: emergency_contact_phone || null,
      status: 'active'
    }
  );

  // Mark invite as used
  await client.update(
    'onboarding_invites',
    `token=eq.${token}`,
    { used_at: new Date().toISOString(), used_by: user_id }
  );

  return Response.json({ success: true });
}
