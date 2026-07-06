// Authenticated portal data API — used by portal-customer.html
// All requests: POST with Authorization: Bearer <session_token> and JSON body { action, ...params }

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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function verifySession(token, SERVICE_KEY) {
  if (!token) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/crm_portal_users?session_token=eq.${token}&status=eq.active&select=*&limit=1`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
  );
  const rows = await res.json();
  if (!rows?.length) return null;
  const user = rows[0];
  if (user.session_expires_at && new Date(user.session_expires_at) < new Date()) return null;
  return user;
}

export async function onRequestPost({ request, env }) {
  const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  const user = await verifySession(token, SERVICE_KEY);
  if (!user) return json({ error: 'Unauthorised' }, 401);

  const body = await request.json();
  const { action } = body;
  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  const hj = { ...h, 'Content-Type': 'application/json' };

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (action === 'me') {
    return json({ user: { id: user.id, name: user.name, email: user.email, tenant_id: user.tenant_id, crm_company_id: user.crm_company_id } });
  }

  // ── Tickets ───────────────────────────────────────────────────────────────
  if (action === 'tickets') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_tickets?portal_user_id=eq.${user.id}&order=updated_at.desc`, { headers: h });
    return json({ tickets: await res.json() });
  }

  if (action === 'create_ticket') {
    const { subject, type, description } = body;
    if (!subject) return json({ error: 'Subject required' }, 400);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_tickets`, {
      method: 'POST', headers: { ...hj, Prefer: 'return=representation' },
      body: JSON.stringify({ tenant_id: user.tenant_id, portal_user_id: user.id, crm_company_id: user.crm_company_id || null, subject, type: type || 'support', description: description || null, status: 'open', priority: 'normal' }),
    });
    const [ticket] = await res.json();
    return json({ ticket });
  }

  if (action === 'ticket_messages') {
    const { ticket_id } = body;
    const tRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_tickets?id=eq.${ticket_id}&portal_user_id=eq.${user.id}&select=*&limit=1`, { headers: h });
    const [ticket] = await tRes.json();
    if (!ticket) return json({ error: 'Not found' }, 404);
    const mRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_ticket_messages?ticket_id=eq.${ticket_id}&is_internal=eq.false&order=created_at.asc`, { headers: h });
    return json({ ticket, messages: await mRes.json() });
  }

  if (action === 'post_ticket_message') {
    const { ticket_id, message } = body;
    if (!message?.trim()) return json({ error: 'Message required' }, 400);
    const tRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_tickets?id=eq.${ticket_id}&portal_user_id=eq.${user.id}&select=id,status&limit=1`, { headers: h });
    const [ticket] = await tRes.json();
    if (!ticket) return json({ error: 'Not found' }, 404);
    if (ticket.status === 'closed') return json({ error: 'Ticket is closed' }, 400);
    await fetch(`${SUPABASE_URL}/rest/v1/crm_ticket_messages`, {
      method: 'POST', headers: hj,
      body: JSON.stringify({ ticket_id, sender_type: 'customer', sender_name: user.name || user.email, message: message.trim(), is_internal: false }),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/crm_tickets?id=eq.${ticket_id}`, {
      method: 'PATCH', headers: hj,
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
    });
    return json({ success: true });
  }

  // ── Company chat ──────────────────────────────────────────────────────────
  if (action === 'chat_messages') {
    if (!user.crm_company_id) return json({ messages: [] });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_messages?crm_company_id=eq.${user.crm_company_id}&tenant_id=eq.${user.tenant_id}&order=created_at.asc&limit=150`, { headers: h });
    // Mark unread customer messages as read (team will handle; just update read_at for portal)
    return json({ messages: await res.json() });
  }

  if (action === 'send_chat_message') {
    if (!user.crm_company_id) return json({ error: 'No company linked to your account' }, 400);
    const { body: msgBody } = body;
    if (!msgBody?.trim()) return json({ error: 'Message required' }, 400);
    await fetch(`${SUPABASE_URL}/rest/v1/crm_messages`, {
      method: 'POST', headers: hj,
      body: JSON.stringify({ tenant_id: user.tenant_id, crm_company_id: user.crm_company_id, sender_type: 'customer', sender_name: user.name || user.email, body: msgBody.trim() }),
    });
    return json({ success: true });
  }

  // ── Documents ─────────────────────────────────────────────────────────────
  if (action === 'documents') {
    if (!user.crm_company_id) return json({ documents: [] });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_documents?crm_company_id=eq.${user.crm_company_id}&is_portal_visible=eq.true&order=created_at.desc`, { headers: h });
    return json({ documents: await res.json() });
  }

  // ── Quotes / E-signatures ─────────────────────────────────────────────────
  if (action === 'quotes') {
    if (!user.crm_company_id) return json({ quotes: [] });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_quotes?crm_company_id=eq.${user.crm_company_id}&order=created_at.desc`, { headers: h });
    return json({ quotes: await res.json() });
  }

  if (action === 'sign_quote') {
    const { quote_id, signer_name } = body;
    if (!signer_name?.trim()) return json({ error: 'Full name required to sign' }, 400);
    const qRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_quotes?id=eq.${quote_id}&crm_company_id=eq.${user.crm_company_id}&select=id,status&limit=1`, { headers: h });
    const [quote] = await qRes.json();
    if (!quote) return json({ error: 'Quote not found' }, 404);
    if (quote.status === 'accepted') return json({ error: 'Already signed' }, 400);
    await fetch(`${SUPABASE_URL}/rest/v1/crm_quotes?id=eq.${quote_id}`, {
      method: 'PATCH', headers: hj,
      body: JSON.stringify({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        signed_by_name: signer_name.trim(),
        signed_by_portal_user_id: user.id,
        signature_data: `Signed by ${signer_name.trim()} on ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
      }),
    });
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, 400);
}
