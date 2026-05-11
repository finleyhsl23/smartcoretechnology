export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Missing Supabase env vars");
    const body = await context.request.json();
    const auth = context.request.headers.get("authorization") || "";
    let actor_email = null;
    let actor_user_id = null;
    if (auth.startsWith("Bearer ")) {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE, Authorization: auth } });
      if (userRes.ok) { const user = await userRes.json(); actor_email = user.email || null; actor_user_id = user.id || null; }
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/audit_logs`, {
      method: "POST",
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ action: body.action, target_table: body.target_table, target_id: String(body.target_id || ""), metadata: body.metadata || {}, actor_email, actor_user_id })
    });
    if (!res.ok) throw new Error(await res.text());
    return json({ ok: true });
  } catch (error) { return json({ ok: false, error: error.message || String(error) }, 400); }
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}})}
