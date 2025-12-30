// functions/api/verify-code.js
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));

    const purpose = String(body.purpose || "owner_signup"); // "owner_signup" | "employee_signup"
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    const password = String(body.password || "");
    const full_name = String(body.full_name || "").trim();

    // Owner signup fields
    const company_name = String(body.company_name || "").trim();
    const company_code =
      body.company_code ? String(body.company_code).trim().toUpperCase() : null;

    if (!env.SUPABASE_URL) return jsonErr("Missing SUPABASE_URL env var", 500);
    if (!env.SUPABASE_SERVICE_ROLE_KEY)
      return jsonErr("Missing SUPABASE_SERVICE_ROLE_KEY env var", 500);
    if (!env.CODE_SALT) return jsonErr("Missing CODE_SALT env var", 500);

    if (!email) return jsonErr("Missing email", 400);
    if (!code || !/^\d{6}$/.test(code)) return jsonErr("Invalid code", 400);

    // For owner + employee we need password + name
    if (!password || password.length < 8)
      return jsonErr("Password must be at least 8 characters", 400);
    if (!full_name) return jsonErr("Missing full_name", 400);

    if (purpose === "owner_signup") {
      if (!company_name) return jsonErr("Missing company_name", 400);
    }
    if (purpose === "employee_signup") {
      if (!company_code) return jsonErr("Missing company_code", 400);
    }

    // 1) Hash code (same as send-code.js)
    const code_hash = await sha256Hex(code + env.CODE_SALT);

    // 2) Fetch latest valid code row for this email+purpose (+company_code for employee)
    const filters = new URLSearchParams();
    filters.set("select", "id,email,code_hash,purpose,company_code,expires_at,used_at,created_at");
    filters.set("email", `eq.${email}`);
    filters.set("purpose", `eq.${purpose}`);
    filters.set("order", "created_at.desc");
    filters.set("limit", "1");
    if (purpose === "employee_signup") {
      filters.set("company_code", `eq.${company_code}`);
    }

    const codeRes = await sbRest(
      env,
      `/rest/v1/signup_codes?${filters.toString()}`,
      { method: "GET" }
    );
    if (!codeRes.ok) {
      return jsonErr(`Supabase lookup failed: ${await codeRes.text()}`, 500);
    }

    const rows = await codeRes.json();
    const row = rows?.[0];
    if (!row) return jsonErr("Code not found. Request a new code.", 400);

    if (row.used_at) return jsonErr("This code has already been used.", 400);

    const now = Date.now();
    const exp = Date.parse(row.expires_at);
    if (!Number.isFinite(exp) || exp < now) return jsonErr("Code expired. Request a new one.", 400);

    if (row.code_hash !== code_hash) return jsonErr("Incorrect code.", 400);

    // 3) Mark code as used immediately (prevents re-use race)
    const usedAt = new Date().toISOString();
    const markRes = await sbRest(
      env,
      `/rest/v1/signup_codes?id=eq.${encodeURIComponent(row.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ used_at: usedAt }),
      }
    );
    if (!markRes.ok) {
      return jsonErr(`Failed to mark code used: ${await markRes.text()}`, 500);
    }

    // 4) Create Auth user ONLY AFTER code verified
    const createUserRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true, // you are handling verification yourself via code
        user_metadata: {
          full_name,
          signup_purpose: purpose,
        },
      }),
    });

    const createUserTxt = await createUserRes.text();
    if (!createUserRes.ok) {
      // Best-effort: un-use the code so user can retry
      await sbRest(env, `/rest/v1/signup_codes?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ used_at: null }),
      }).catch(() => {});
      return jsonErr(`Create user failed: ${createUserTxt}`, 500);
    }

    const createdUser = safeJson(createUserTxt);
    const userId = createdUser?.id;
    if (!userId) {
      // Same rollback attempt
      await sbRest(env, `/rest/v1/signup_codes?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ used_at: null }),
      }).catch(() => {});
      return jsonErr("Create user failed (no id)", 500);
    }

    // 5) Owner signup: create company + subscription
    // Employee signup: attach employee record to existing company
    if (purpose === "owner_signup") {
      // generate company code if not provided (3 letters + 6 digits)
      const newCompanyCode = company_code || await generateCompanyCode(env, company_name);

      // Create company
      const companyPayload = {
        owner_user_id: userId,
        company_name,
        company_code: newCompanyCode,
      };

      const compRes = await sbRest(env, `/rest/v1/companies`, {
        method: "POST",
        headers: { "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify([companyPayload]),
      });

      const compTxt = await compRes.text();
      if (!compRes.ok) {
        return jsonErr(`Create company failed: ${compTxt}`, 500);
      }

      const compJson = safeJson(compTxt);
      const companyRow = Array.isArray(compJson) ? compJson[0] : compJson;
      const companyId = companyRow?.id;

      if (!companyId) {
        return jsonErr("Create company failed (no company id returned)", 500);
      }

      // Create starter subscription row (free/testing)
      // NOTE: This assumes you have a subscriptions table. If not, delete this block.
      await sbRest(env, `/rest/v1/subscriptions`, {
        method: "POST",
        headers: { "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify([
          {
            company_id: companyId,
            owner_user_id: userId,
            status: "trial",
            monthly_total: 0,
            company_size_tier: null,
            modules: [],
          },
        ]),
      }).catch(() => {});

      // Optional cleanup: delete other unused codes for this email/purpose
      await sbRest(env, `/rest/v1/signup_codes?email=eq.${email}&purpose=eq.${purpose}&used_at=is.null`, {
        method: "DELETE",
      }).catch(() => {});

      return jsonOK({
        ok: true,
        purpose,
        user_id: userId,
        company: {
          id: companyId,
          company_name,
          company_code: newCompanyCode,
        },
      });
    }

    if (purpose === "employee_signup") {
      // Find company by company_code
      const q = new URLSearchParams();
      q.set("select", "id,company_name,company_code");
      q.set("company_code", `eq.${company_code}`);
      q.set("limit", "1");

      const findRes = await sbRest(env, `/rest/v1/companies?${q.toString()}`, { method: "GET" });
      if (!findRes.ok) return jsonErr(`Company lookup failed: ${await findRes.text()}`, 500);

      const found = await findRes.json();
      const company = found?.[0];
      if (!company?.id) return jsonErr("Company code not found.", 400);

      // Create employee row
      // NOTE: assumes employees table has: company_id, user_id, full_name, role_title, job_category, employee_code
      const employee_code = await generateEmployeeCode(env, full_name);

      const empRes = await sbRest(env, `/rest/v1/employees`, {
        method: "POST",
        headers: { "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify([
          {
            company_id: company.id,
            user_id: userId,
            full_name,
            employee_code,
            role_title: null,
            job_category: null,
          },
        ]),
      });

      const empTxt = await empRes.text();
      if (!empRes.ok) return jsonErr(`Create employee failed: ${empTxt}`, 500);

      await sbRest(env, `/rest/v1/signup_codes?email=eq.${email}&purpose=eq.${purpose}&used_at=is.null`, {
        method: "DELETE",
      }).catch(() => {});

      return jsonOK({
        ok: true,
        purpose,
        user_id: userId,
        company,
        employee_code,
      });
    }

    return jsonErr("Unknown purpose", 400);
  } catch (e) {
    return jsonErr(`Error: ${e?.message || e}`, 500);
  }
}

/* ---------------- Helpers ---------------- */

function jsonOK(data) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
}
function jsonErr(message, status = 500) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function safeJson(txt) {
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sbRest(env, path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("apikey", env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set("authorization", `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  headers.set("accept", "application/json");
  return fetch(`${env.SUPABASE_URL}${path}`, { ...init, headers });
}

function letters3(str) {
  const cleaned = (str || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return (cleaned.slice(0, 3) || "XXX").padEnd(3, "X");
}

async function generateCompanyCode(env, companyName) {
  const prefix = letters3(companyName);
  // Try a few times to avoid collisions
  for (let i = 0; i < 25; i++) {
    const digits = String(Math.floor(100000 + Math.random() * 900000));
    const code = `${prefix}${digits}`;

    const q = new URLSearchParams();
    q.set("select", "id");
    q.set("company_code", `eq.${code}`);
    q.set("limit", "1");

    const res = await sbRest(env, `/rest/v1/companies?${q.toString()}`, { method: "GET" });
    if (!res.ok) continue;
    const rows = await res.json();
    if (!rows?.length) return code;
  }
  // fallback (extremely unlikely)
  return `${prefix}${Date.now().toString().slice(-6)}`;
}

async function generateEmployeeCode(env, fullName) {
  const prefix = letters3(fullName);
  for (let i = 0; i < 25; i++) {
    const digits = String(Math.floor(100000000 + Math.random() * 900000000)); // 9 digits
    const code = `${prefix}${digits}`;

    const q = new URLSearchParams();
    q.set("select", "id");
    q.set("employee_code", `eq.${code}`);
    q.set("limit", "1");

    const res = await sbRest(env, `/rest/v1/employees?${q.toString()}`, { method: "GET" });
    if (!res.ok) continue;
    const rows = await res.json();
    if (!rows?.length) return code;
  }
  return `${prefix}${Math.floor(100000000 + Math.random() * 900000000)}`;
}
