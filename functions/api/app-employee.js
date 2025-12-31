export async function onRequestPost({ request, env }) {
  try {
    const token = getBearer(request);
    if (!token) return jsonErr("Missing authorization token", 401);

    const { user_id } = await getUserFromToken(env, token);
    if (!user_id) return jsonErr("Invalid session", 401);

    const b = await request.json().catch(()=>({}));
    const full_name = String(b.full_name || "").trim();
    const job_title = String(b.job_title || "").trim();
    const job_category = String(b.job_category || "").trim();

    if (!full_name) return jsonErr("Missing full_name", 400);

    // get company for this user
    const profile = await getProfile(env, user_id);
    if (!profile?.company_id) return jsonErr("No company linked to this user.", 400);

    const company = await getCompany(env, profile.company_id);
    if (!company) return jsonErr("Company not found.", 404);

    // enforce employee max if set
    const existing = await listEmployees(env, company.id);
    const max = company.max_employees ?? null;
    if (max && existing.length >= max) {
      return jsonErr(`Employee limit reached (${existing.length}/${max}). Please upgrade your plan to add more employees.`, 409);
    }

    const prefix = String(company.company_name || "COM").replace(/[^a-z0-9]/gi,"").toUpperCase().slice(0,3).padEnd(3,"X");
    const employee_id = await generateEmployeeId(env, company.id, prefix);

    // insert employee
    const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/employees`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type":"application/json",
        prefer: "return=minimal"
      },
      body: JSON.stringify([{
        company_id: company.id,
        full_name,
        job_title,
        job_category,
        employee_id,
        is_admin: false
      }])
    });

    if (!ins.ok) {
      const t = await ins.text();
      return jsonErr(`Insert failed: ${t}`, 500);
    }

    const employees = await listEmployees(env, company.id);
    return jsonOk({ ok:true, company, employees });

  } catch (e) {
    return jsonErr(e?.message || String(e), 500);
  }
}

function jsonOk(obj){ return new Response(JSON.stringify(obj), { headers:{ "content-type":"application/json" }}); }
function jsonErr(msg, status=400){ return new Response(JSON.stringify({ ok:false, error:msg }), { status, headers:{ "content-type":"application/json" }}); }

function getBearer(req){
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getUserFromToken(env, token){
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`
    }
  });
  const data = await res.json().catch(()=>null);
  if (!res.ok) throw new Error(data?.message || "Auth lookup failed");
  return { user_id: data?.id };
}

async function getProfile(env, user_id){
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=*&user_id=eq.${encodeURIComponent(user_id)}&limit=1`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const arr = await r.json().catch(()=>[]);
  return arr?.[0] || null;
}

async function getCompany(env, company_id){
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/companies?select=*&id=eq.${encodeURIComponent(company_id)}&limit=1`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const arr = await r.json().catch(()=>[]);
  return arr?.[0] || null;
}

async function listEmployees(env, company_id){
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/employees?select=*&company_id=eq.${encodeURIComponent(company_id)}&order=created_at.asc`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  return await r.json().catch(()=>[]);
}

async function generateEmployeeId(env, company_id, prefix){
  for (let i=0;i<80;i++){
    const num = Math.floor(Math.random()*1e9).toString().padStart(9,"0");
    const eid = `${prefix}${num}`;
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/employees?select=id&company_id=eq.${encodeURIComponent(company_id)}&employee_id=eq.${encodeURIComponent(eid)}&limit=1`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
    });
    const arr = await r.json().catch(()=>[]);
    if (!arr?.length) return eid;
  }
  return `${prefix}${Math.floor(Math.random()*1e9).toString().padStart(9,"0")}`;
}
