export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    await checkSession(context, body.session_id);
    const archived = body.archived ? "true" : "false";
    const rows = await serviceJson(context, `/rest/v1/credentials_vault?select=*&archived=eq.${archived}&order=created_at.desc`);
    const items = [];
    for (const row of rows || []) items.push({ id: row.id, archived: row.archived, ...(await decryptPayload(context, row.encrypted_payload)) });
    return json({ ok: true, items });
  } catch (error) { return json({ ok: false, error: error.message || String(error) }, 400); }
}
async function checkSession(context, session_id) {
  if (!session_id) throw new Error("Vault locked");
  const rows = await serviceJson(context, `/rest/v1/vault_sessions?select=*&session_id=eq.${encodeURIComponent(session_id)}&limit=1`);
  const s = rows?.[0];
  if (!s || new Date(s.expires_at).getTime() < Date.now()) throw new Error("Vault session expired");
  await serviceFetch(context, `/rest/v1/vault_sessions?session_id=eq.${encodeURIComponent(session_id)}`, { method: "PATCH", body: JSON.stringify({ expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString() }) });
}
async function decryptPayload(context, encrypted) {
  if (!encrypted) return {};
  const key = await getKey(context);
  const data = fromB64(encrypted);
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}
async function getKey(context) {
  const secret = context.env.VAULT_ENCRYPTION_KEY || context.env.VAULT_CODE;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}
function fromB64(b64) { const bin = atob(b64); return Uint8Array.from(bin, c => c.charCodeAt(0)); }
async function serviceJson(context, path) { const r = await serviceFetch(context, path); return r.json(); }
async function serviceFetch(context, path, init = {}) { const url=context.env.SUPABASE_URL, key=context.env.SUPABASE_SERVICE_ROLE; if(!url||!key)throw new Error("Missing Supabase env vars"); const res=await fetch(url+path,{...init,headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",...(init.headers||{})}}); if(!res.ok)throw new Error(await res.text()); return res; }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
