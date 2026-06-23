// POST /api/crm/messages-poll
// Body: { company_id }
// Auth: Bearer <supabase access token>
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts";

export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;

    const auth  = context.request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await context.request.json();
    const company_id = body?.company_id;
    if (!company_id) return json({ ok: false, error: "company_id required" }, 400);

    const svcHdr = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    };

    // Verify user token → get their Supabase user id
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return json({ ok: false, error: "Unauthorized" }, 401);
    const userData = await userRes.json();
    const userId = userData?.id;
    if (!userId) return json({ ok: false, error: "Unauthorized" }, 401);

    // Get tenant_id from core_employees using service role
    const empRes = await fetch(
      `${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${userId}&select=company_id&limit=1`,
      { headers: svcHdr }
    );
    const employees = await empRes.json();
    const tenantId = employees?.[0]?.company_id;
    if (!tenantId) return json({ ok: false, error: "Unauthorized" }, 401);

    // Verify company belongs to this tenant
    const coRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_companies?id=eq.${company_id}&tenant_id=eq.${tenantId}&select=id&limit=1`,
      { headers: svcHdr }
    );
    const companies = await coRes.json();
    if (!companies?.length) return json({ ok: false, error: "Forbidden" }, 403);

    // Fetch all messages for this company thread using service role (bypasses RLS)
    const msgsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_messages?tenant_id=eq.${tenantId}&crm_company_id=eq.${company_id}&order=created_at`,
      { headers: svcHdr }
    );
    const messages = await msgsRes.json();

    return json({ ok: true, messages: Array.isArray(messages) ? messages : [] });
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
