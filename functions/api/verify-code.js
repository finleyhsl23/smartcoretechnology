export async function onRequestPost({ request, env }) {
  try {
    const b = await request.json().catch(() => ({}));

    const purpose = String(b.purpose || "");
    const email = String(b.email || "").trim().toLowerCase();
    const code = String(b.code || "").trim();
    const password = String(b.password || "");
    const company_name = b.company_name ? String(b.company_name).trim() : null;
    const company_size = b.company_size ? String(b.company_size).trim() : null;
    const module_ids = Array.isArray(b.module_ids) ? b.module_ids.map(String) : [];
    const company_code = b.company_code ? String(b.company_code).trim().toUpperCase() : null;
    const full_name = b.full_name ? String(b.full_name).trim() : null;

    if (!env.SUPABASE_URL) return jsonErr("Missing SUPABASE_URL env var", 500);
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return jsonErr("Missing SUPABASE_SERVICE_ROLE_KEY env var", 500);
    if (!env.CODE_SALT) return jsonErr("Missing CODE_SALT env var", 500);

    if (!purpose) return jsonErr("Missing purpose", 400);
    if (!email) return jsonErr("Missing email", 400);
    if (!code || code.length !== 6) return jsonErr("Missing/invalid code", 400);
    if (!password || password.length < 8) return jsonErr("Password must be at least 8 characters", 400);

    // Hash code
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(code + env.CODE_SALT));
    const code_hash = Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, "0")).join("");

    // Find latest valid code row
    const codesRes = await fetch(`${env.SUPABASE_URL}/rest/v1/signup_codes?select=id,email,code_hash,purpose,company_code,full_name,expires_at,created_at&email=eq.${encodeURIComponent(email)}&purpose=eq.${encodeURIComponent(purpose)}&order=created_at.desc&limit=1`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      }
    });

    const codes = await codesRes.json().catch(()=>[]);
    const row = codes?.[0];
    if (!row) return jsonErr("No code found. Please request a new one.", 400);

    if (row.code_hash !== code_hash) return jsonErr("Incorrect code. Please try again.", 400);

    const exp = new Date(row.expires_at).getTime();
    if (Date.now() > exp) return jsonErr("That code has expired. Please request a new one.", 400);

    // Create auth user (ONLY now)
    const createUserRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true
      })
    });

    const created = await createUserRes.json().catch(()=>null);
    if (!createUserRes.ok) {
      const msg = created?.msg || created?.message || JSON.stringify(created);
      // common: already registered
      if (String(msg).toLowerCase().includes("already")) {
        return jsonErr("This email is already registered to a SmartCore account. Please log in instead.", 400);
      }
      return jsonErr(`Create user failed: ${msg}`, 500);
    }

    const user_id = created?.id;
    if (!user_id) return jsonErr("Create user failed (no id)", 500);

    // Owner signup creates company + subscription rows
    if (purpose === "owner_signup") {
      if (!company_name) return jsonErr("Missing company_name", 400);
      if (!company_size) return jsonErr("Missing company_size", 400);
      if (!module_ids.length) return jsonErr("Missing module_ids", 400);

      // create company
      const company_code_gen = await makeCompanyCode(company_name, env);

      const coIns = await fetch(`${env.SUPABASE_URL}/rest/v1/companies`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "content-type":"application/json",
          prefer: "return=representation"
        },
        body: JSON.stringify([{
          company_name,
          company_size,            // IMPORTANT: saves company_size
          owner_user_id: user_id,
          company_code: company_code_gen,
          max_employees: maxForPlan(company_size) // enforce employee caps
        }])
      });

      const coArr = await coIns.json().catch(()=>[]);
      if (!coIns.ok) return jsonErr(`Create company failed: ${JSON.stringify(coArr)}`, 500);

      const company = coArr?.[0];
      if (!company?.id) return jsonErr("Create company failed (no company id).", 500);

      // create profile (store company_name too)
      await upsertProfile(env, {
        user_id,
        company_id: company.id,
        company_name,
        role: "owner",
        is_admin: false
      });

      // create subscription rows
      await upsertSubscription(env, {
        user_id,
        company_id: company.id,
        company_size,
        module_ids
      });

      // delete code row
      await deleteCode(env, row.id);

      return jsonOk({ ok:true, user_id, company_id: company.id });
    }

    // Employee signup joins existing company and must match name + company_code
    if (purpose === "employee_signup") {
      const ccode = company_code || row.company_code;
      const fname = full_name || row.full_name;

      if (!ccode) return jsonErr("Missing company code", 400);
      if (!fname) return jsonErr("Missing full name", 400);

      // find company
      const coRes = await fetch(`${env.SUPABASE_URL}/rest/v1/companies?select=id,company_name,company_code&company_code=eq.${encodeURIComponent(ccode)}&limit=1`, {
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
      });
      const coArr = await coRes.json().catch(()=>[]);
      const company = coArr?.[0];
      if (!company) return jsonErr("We couldn’t find that company code. Please contact your system admin.", 400);

      // verify employee exists by name
      const empRes = await fetch(`${env.SUPABASE_URL}/rest/v1/employees?select=id,full_name&company_id=eq.${company.id}&full_name=ilike.${encodeURIComponent(fname)}&limit=1`, {
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
      });
      const empArr = await empRes.json().catch(()=>[]);
      const found = empArr?.[0];
      if (!found) {
        return jsonErr("We couldn’t find your details attached to this company yet. Please contact your system admin to confirm you’ve been added as an employee.", 400);
      }

      // profile
      await upsertProfile(env, {
        user_id,
        company_id: company.id,
        company_name: company.company_name,
        full_name: fname,
        role: "employee",
        is_admin: false
      });

      await deleteCode(env, row.id);
      return jsonOk({ ok:true, user_id, company_id: company.id });
    }

    // unknown
    return jsonErr("Unknown purpose", 400);

  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error: e?.message || String(e) }), {
      status: 500,
      headers: { "content-type":"application/json" }
    });
  }
}

function jsonOk(obj){
  return new Response(JSON.stringify(obj), { headers:{ "content-type":"application/json" }});
}
function jsonErr(msg, status=400){
  return new Response(JSON.stringify({ ok:false, error: msg }), {
    status,
    headers:{ "content-type":"application/json" }
  });
}

function maxForPlan(plan){
  if (plan === "up_to_25") return 25;
  if (plan === "26_100") return 100;
  if (plan === "101_250") return 250;
  return null; // 250+ custom
}

async function makeCompanyCode(company_name, env){
  const prefix = String(company_name).replace(/[^a-z0-9]/gi,"").toUpperCase().slice(0,3).padEnd(3,"X");
  for (let i=0;i<50;i++){
    const num = Math.floor(100000 + Math.random()*900000);
    const code = `${prefix}${num}`;

    // ensure unique
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/companies?select=id&company_code=eq.${encodeURIComponent(code)}&limit=1`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
    });
    const arr = await r.json().catch(()=>[]);
    if (!arr?.length) return code;
  }
  // fallback
  return `${prefix}${Math.floor(100000 + Math.random()*900000)}`;
}

async function upsertProfile(env, profile){
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type":"application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify([profile])
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Profile upsert failed: ${t}`);
  }
}

async function upsertSubscription(env, sub){
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/subscriptions`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type":"application/json",
      prefer: "return=minimal"
    },
    body: JSON.stringify([sub])
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Subscription insert failed: ${t}`);
  }
}

async function deleteCode(env, id){
  await fetch(`${env.SUPABASE_URL}/rest/v1/signup_codes?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
}
