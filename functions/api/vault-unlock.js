export async function onRequestPost(context) {
  try {
    const { code } = await context.request.json();
    if (!context.env.VAULT_CODE) throw new Error("Missing VAULT_CODE env var");
    if (String(code || "") !== String(context.env.VAULT_CODE)) throw new Error("Incorrect vault code");
    const session_id = crypto.randomUUID();
    await serviceFetch(context, "/rest/v1/vault_sessions", {
      method: "POST",
      body: JSON.stringify({ session_id, expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
    });
    return json({ ok: true, session_id });
  } catch (error) { return json({ ok: false, error: error.message || String(error) }, 400); }
}
async function serviceFetch(context, path, init = {}) {
  const url = context.env.SUPABASE_URL;
  const key = context.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  const res = await fetch(url + path, { ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) } });
  if (!res.ok) throw new Error(await res.text());
  return res;
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
