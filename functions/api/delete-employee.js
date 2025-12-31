export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const company_id = String(body.company_id || "").trim();
    const employee_id = String(body.employee_id || "").trim();

    if (!env.SUPABASE_URL) return jsonErr("Missing SUPABASE_URL env var");
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return jsonErr("Missing SUPABASE_SERVICE_ROLE_KEY env var");
    if (!company_id) return jsonErr("Missing company_id", 400);
    if (!employee_id) return jsonErr("Missing employee_id", 400);

    // Fetch employee (to get user_id if any)
    const get = await fetch(`${env.SUPABASE_URL}/rest/v1/employees?select=*&id=eq.${employee_id}&company_id=eq.${company_id}&limit=1`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      }
    });

    if (!get.ok){
      const t = await get.text();
      return jsonErr(`Fetch employee failed: ${t}`);
    }
    const emp = (await get.json().catch(()=>[]))?.[0];
    if (!emp) return jsonErr("Employee not found.", 404);

    // Delete employee row
    const del = await fetch(`${env.SUPABASE_URL}/rest/v1/employees?id=eq.${employee_id}&company_id=eq.${company_id}`, {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      }
    });
    if (!del.ok){
      const t = await del.text();
      return jsonErr(`Delete employee failed: ${t}`);
    }

    // If linked to an auth user, delete auth user + profile
    if (emp.user_id){
      await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?user_id=eq.${emp.user_id}`, {
        method: "DELETE",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        }
      });

      await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${emp.user_id}`, {
        method: "DELETE",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        }
      });
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
