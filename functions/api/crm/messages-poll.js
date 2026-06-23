// POST /api/crm/messages-poll
// Body: { company_id, after?: ISO timestamp }
// Auth: Bearer <supabase access token>
// Uses service role to bypass RLS — validates user via Supabase auth then core_employees
export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    const ANON_KEY     = context.env.SUPABASE_ANON_KEY;

    const auth  = context.request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ ok: false, error: "Unauthorized" }, 401);

    const { company_id, after } = await context.request.json();
    if (!company_id) return json({ ok: false, error: "company_id required" }, 400);

    // Verify the user's Supabase token
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY || SERVICE_ROLE, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return json({ ok: false, error: "Unauthorized" }, 401);
    const { id: userId } = await userRes.json();
    if (!userId) return json({ ok: false, error: "Unauthorized" }, 401);

    // Verify employee belongs to the same tenant as the requested company
    const svcHeaders = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    };
    const empRes = await fetch(
      `${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${userId}&select=company_id&limit=1`,
      { headers: svcHeaders }
    );
    const employees = await empRes.json();
    const tenantId = employees?.[0]?.company_id;
    if (!tenantId) return json({ ok: false, error: "Unauthorized" }, 401);

    // Verify the company belongs to this tenant
    const coRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_companies?id=eq.${company_id}&tenant_id=eq.${tenantId}&select=id&limit=1`,
      { headers: svcHeaders }
    );
    const companies = await coRes.json();
    if (!companies?.length) return json({ ok: false, error: "Forbidden" }, 403);

    // Fetch messages — optionally only those after a timestamp
    let url = `${SUPABASE_URL}/rest/v1/crm_messages?tenant_id=eq.${tenantId}&crm_company_id=eq.${company_id}&order=created_at`;
    if (after) url += `&created_at=gt.${encodeURIComponent(after)}`;

    const msgsRes = await fetch(url, { headers: svcHeaders });
    const messages = await msgsRes.json();

    return json({ ok: true, messages: messages || [] });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 400);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
