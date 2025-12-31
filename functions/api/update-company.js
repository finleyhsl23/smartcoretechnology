export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const company_id = String(body.company_id || "").trim();
    if (!company_id) return jsonErr("Missing company_id", 400);

    if (!env.SUPABASE_URL) return jsonErr("Missing SUPABASE_URL env var");
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return jsonErr("Missing SUPABASE_SERVICE_ROLE_KEY env var");

    const patch = {};
    ["company_name","address","logo_url","primary_color","secondary_color","text_color"].forEach(k=>{
      if (body[k] !== undefined) patch[k] = body[k];
    });

    if (!Object.keys(patch).length) return jsonErr("Nothing to update", 400);

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/companies?id=eq.${company_id}`, {
      method: "PATCH",
      headers: {
        "content-type":"application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        prefer: "return=minimal"
      },
      body: JSON.stringify(patch)
    });

    if (!res.ok){
      const t = await res.text();
      return jsonErr(`Update company failed: ${t}`);
    }

    return jsonOk({ ok:true });
  } catch (e) {
    return jsonErr(`Error: ${e?.message || e}`);
  }
}

function jsonOk(obj, status=200){
  return new Response(JSON.stringify(obj), { status, headers:{ "content-type":"application/json" }});
}
function jsonErr(msg, status=500){
  return new Response(JSON.stringify({ ok:false, error: msg }), { status, headers:{ "content-type":"application/json" }});
}
