export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    await checkSession(context, body.session_id);
    if (!body.id) throw new Error("Missing credential id");
    const update = {};
    if (typeof body.archived === "boolean") update.archived = body.archived;
    if (body.name || body.username || body.email || body.password || body.details) {
      const payload = { name: body.name || "Untitled", username: body.username || "", email: body.email || "", password: body.password || "", details: body.details || {} };
      update.name = payload.name;
      update.encrypted_payload = await encryptPayload(context, payload);
    }
    await serviceFetch(context, `/rest/v1/credentials_vault?id=eq.${encodeURIComponent(body.id)}`, { method: "PATCH", body: JSON.stringify(update) });
    return json({ ok: true });
  } catch (error) { return json({ ok: false, error: error.message || String(error) }, 400); }
}
async function checkSession(context, session_id) { if (!session_id) throw new Error("Vault locked"); const rows=await serviceJson(context,`/rest/v1/vault_sessions?select=*&session_id=eq.${encodeURIComponent(session_id)}&limit=1`); const s=rows?.[0]; if(!s||new Date(s.expires_at).getTime()<Date.now())throw new Error("Vault session expired"); await serviceFetch(context,`/rest/v1/vault_sessions?session_id=eq.${encodeURIComponent(session_id)}`,{method:"PATCH",body:JSON.stringify({expires_at:new Date(Date.now()+5*60*1000).toISOString()})}); }
async function encryptPayload(context, payload) { const key=await getKey(context); const iv=crypto.getRandomValues(new Uint8Array(12)); const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify(payload)))); const out=new Uint8Array(iv.length+ct.length); out.set(iv,0); out.set(ct,iv.length); return b64(out); }
async function getKey(context) { const secret=context.env.VAULT_ENCRYPTION_KEY||context.env.VAULT_CODE; const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret)); return crypto.subtle.importKey("raw",hash,"AES-GCM",false,["encrypt","decrypt"]); }
function b64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
async function serviceJson(context,path){const r=await serviceFetch(context,path);return r.json()} async function serviceFetch(context,path,init={}){const url=context.env.SUPABASE_URL,key=context.env.SUPABASE_SERVICE_ROLE;if(!url||!key)throw new Error("Missing Supabase env vars");const res=await fetch(url+path,{...init,headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",Prefer:"return=minimal",...(init.headers||{})}});if(!res.ok)throw new Error(await res.text());return res} function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}})}
