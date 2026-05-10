export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL env var");
    if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE env var");

    const body = await context.request.json();
    if (!body.session_id) throw new Error("Missing vault session");

    const headers = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json"
    };

    const sessionRes = await fetch(`${SUPABASE_URL}/rest/v1/vault_sessions?id=eq.${encodeURIComponent(body.session_id)}&select=*`, { headers });
    if (!sessionRes.ok) throw new Error(await sessionRes.text());
    const sessions = await sessionRes.json();
    const session = sessions[0];
    if (!session) throw new Error("Vault session not found");
    if (new Date(session.expires_at).getTime() < Date.now()) throw new Error("Vault session expired");

    const payload = {};
    ["name", "username", "email", "password", "details", "archived"].forEach(k => {
      if (body[k] !== undefined) payload[k] = body[k];
    });
    payload.updated_at = new Date().toISOString();

    let res;
    if (body.id) {
      res = await fetch(`${SUPABASE_URL}/rest/v1/vault_credentials?id=eq.${encodeURIComponent(body.id)}`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch(`${SUPABASE_URL}/rest/v1/vault_credentials`, {
        method: "POST",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ ...payload, archived: false })
      });
    }
    if (!res.ok) throw new Error(await res.text());
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e.message || String(e) }, 400);
  }
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
