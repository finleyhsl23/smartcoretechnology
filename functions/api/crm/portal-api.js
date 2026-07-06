// Authenticated portal data API — used by portal-customer.html
// All requests need Authorization: Bearer <session_token>

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
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401, headers: CORS });

  const body = await request.json();
  const { action } = body;

  if (action === 'me') {
    return new Response(JSON.stringify({ user: { id: user.id, name: user.name, email: user.email, tenant_id: user.tenant_id } }), { headers: CORS });
  }

  if (action === 'tickets') {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_tickets?portal_user_id=eq.${user.id}&order=created_at.desc`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const tickets = await res.json();
    return new Response(JSON.stringify({ tickets }), { headers: CORS });
  }

  if (action === 'create_ticket') {
    const { subject, type, description } = body;
    if (!subject) return new Response(JSON.stringify({ error: 'Subject required' }), { status: 400, headers: CORS });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_tickets`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        tenant_id: user.tenant_id,
        portal_user_id: user.id,
        crm_company_id: user.crm_company_id || null,
        subject,
        type: type || 'support',
        description: description || null,
        status: 'open',
        priority: 'normal',
      }),
    });
    const [ticket] = await res.json();
    return new Response(JSON.stringify({ ticket }), { headers: CORS });
  }

  if (action === 'messages') {
    const { ticket_id } = body;
    // Verify ticket belongs to this user
    const tRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_tickets?id=eq.${ticket_id}&portal_user_id=eq.${user.id}&select=id,subject,status,type,priority,description,created_at&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const [ticket] = await tRes.json();
    if (!ticket) return new Response(JSON.stringify({ error: 'Ticket not found' }), { status: 404, headers: CORS });

    const mRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_ticket_messages?ticket_id=eq.${ticket_id}&is_internal=eq.false&order=created_at.asc`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const messages = await mRes.json();
    return new Response(JSON.stringify({ ticket, messages }), { headers: CORS });
  }

  if (action === 'post_message') {
    const { ticket_id, message } = body;
    if (!message?.trim()) return new Response(JSON.stringify({ error: 'Message required' }), { status: 400, headers: CORS });

    // Verify ticket belongs to this user and is not closed
    const tRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_tickets?id=eq.${ticket_id}&portal_user_id=eq.${user.id}&select=id,status&limit=1`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    const [ticket] = await tRes.json();
    if (!ticket) return new Response(JSON.stringify({ error: 'Ticket not found' }), { status: 404, headers: CORS });
    if (ticket.status === 'closed') return new Response(JSON.stringify({ error: 'Ticket is closed' }), { status: 400, headers: CORS });

    await fetch(`${SUPABASE_URL}/rest/v1/crm_ticket_messages`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket_id, sender_type: 'customer', sender_name: user.name || user.email, message: message.trim(), is_internal: false }),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/crm_tickets?id=eq.${ticket_id}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
    });
    return new Response(JSON.stringify({ success: true }), { headers: CORS });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers: CORS });
}
