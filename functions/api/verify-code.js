// /functions/api/verify-code.js
export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));

    const purpose = String(body.purpose || "owner_signup");
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    const phase = String(body.phase || "verify"); // "verify" | "finalise"

    if (!email) return json({ ok: false, error: "Missing email" }, 400);
    if (!code || code.length !== 6) return json({ ok: false, error: "Missing 6-digit code" }, 400);

    if (!env.SUPABASE_URL) return json({ ok: false, error: "Missing SUPABASE_URL env var" }, 500);
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return json({ ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY env var" }, 500);
    if (!env.CODE_SALT) return json({ ok: false, error: "Missing CODE_SALT env var" }, 500);

    const sbUrl = env.SUPABASE_URL;
    const svc = env.SUPABASE_SERVICE_ROLE_KEY;

    // hash code
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(code + env.CODE_SALT));
    const code_hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

    // Fetch latest un-used code row for this email + purpose
    const q = new URL(`${sbUrl}/rest/v1/signup_codes`);
    q.searchParams.set("select", "id,email,code_hash,purpose,company_code,expires_at,used_at,created_at");
    q.searchParams.set("email", `eq.${email}`);
    q.searchParams.set("purpose", `eq.${purpose}`);
    q.searchParams.set("order", "created_at.desc");
    q.searchParams.set("limit", "1");

    const r = await fetch(q.toString(), {
      headers: {
        apikey: svc,
        authorization: `Bearer ${svc}`,
      },
    });

    if (!r.ok) {
      const t = await r.text();
      return json({ ok: false, error: `Supabase read failed: ${t}` }, 500);
    }

    const rows = await r.json();
    const row = rows?.[0];
    if (!row) return json({ ok: false, error: "Code not found. Please request a new code." }, 400);

    if (row.used_at) return json({ ok: false, error: "That code has already been used. Please request a new one." }, 400);

    const exp = new Date(row.expires_at).getTime();
    if (!Number.isFinite(exp) || Date.now() > exp) {
      return json({ ok: false, error: "That code has expired. Please request a new one." }, 400);
    }

    if (String(row.code_hash) !== code_hash) {
      return json({ ok: false, error: "Incorrect code. Please try again." }, 400);
    }

    // Create a verify_token (stateless). Finalise step recomputes and matches.
    const verify_token = await makeToken(env.CODE_SALT, `${email}|${purpose}|${row.code_hash}|${row.expires_at}|${row.id}`);

    if (phase === "verify") {
      // IMPORTANT: Do NOT create user here
      return json({ ok: true, verified: true, verify_token, expires_at: row.expires_at });
    }

    // -------- Phase: FINALISE (create everything) --------
    const providedToken = String(body.verify_token || "");
    if (!providedToken) return json({ ok: false, error: "Missing verify_token" }, 400);

    const expected = await makeToken(env.CODE_SALT, `${email}|${purpose}|${row.code_hash}|${row.expires_at}|${row.id}`);
    if (providedToken !== expected) {
      return json({ ok: false, error: "Verification expired or invalid. Please request a new code." }, 400);
    }

    // Validate required payload for owner signup
    const full_name = String(body.full_name || "").trim();
    const password = String(body.password || "");
    const company_name = String(body.company_name || "").trim();
    const company_size = String(body.company_size || "").trim(); // keep as text
    const module_ids = Array.isArray(body.module_ids) ? body.module_ids.map(String) : [];

    if (!full_name) return json({ ok: false, error: "Missing full_name" }, 400);
    if (!password || password.length < 8) return json({ ok: false, error: "Password must be at least 8 characters" }, 400);
    if (!company_name) return json({ ok: false, error: "Missing company_name" }, 400);
    if (!company_size) return json({ ok: false, error: "Missing company_size" }, 400);

    // 1) Create auth user (Admin API)
    const createUserRes = await fetch(`${sbUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: svc,
        authorization: `Bearer ${svc}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name },
      }),
    });

    if (!createUserRes.ok) {
      const t = await createUserRes.text();
      // Most common issue: user already exists in auth.users
      return json({ ok: false, error: `Create user failed: ${t}` }, 500);
    }

    const created = await createUserRes.json();
    const user_id = created?.id;
    if (!user_id) return json({ ok: false, error: "Create user failed (no id)" }, 500);

    // 2) Create company
    const company_code = await makeCompanyCode(company_name);

    const insCompany = await fetch(`${sbUrl}/rest/v1/companies`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: svc,
        authorization: `Bearer ${svc}`,
        prefer: "return=representation",
      },
      body: JSON.stringify([{
        company_name,
        owner_user_id: user_id,
        company_code,
        company_size, // <-- save this
      }]),
    });

    if (!insCompany.ok) {
      const t = await insCompany.text();
      return json({ ok: false, error: `Create company failed: ${t}` }, 500);
    }

    const cRows = await insCompany.json();
    const company = cRows?.[0];
    const company_id = company?.id;
    if (!company_id) return json({ ok: false, error: "Create company failed (no company id returned)" }, 500);

    // 3) Create profile
    const insProfile = await fetch(`${sbUrl}/rest/v1/profiles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: svc,
        authorization: `Bearer ${svc}`,
        prefer: "return=minimal",
      },
      body: JSON.stringify([{
        user_id,
        email,
        company_id,
        company_name,          // <-- save this
        full_name,
        role: "owner",
        is_admin: "true",
      }]),
    });

    if (!insProfile.ok) {
      const t = await insProfile.text();
      return json({ ok: false, error: `Create profile failed: ${t}` }, 500);
    }

    // 4) Create subscription ONLY after "payment accept"
    // (payment is mocked, so we just log their chosen modules/size)
    const company_size_label = String(body.company_size_label || company_size);
    const company_size_price = Number(body.company_size_price || 0);
    const modules_total = Number(body.modules_total || 0);
    const total_monthly = Number(body.total_monthly || 0);

    const insSub = await fetch(`${sbUrl}/rest/v1/subscriptions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: svc,
        authorization: `Bearer ${svc}`,
        prefer: "return=minimal",
      },
      body: JSON.stringify([{
        user_id,
        company_size_id: String(body.company_size_id || company_size),
        company_size_label,
        company_size_price,
        selected_modules: module_ids,
        selected_module_ids: module_ids,
        modules_total,
        total_monthly,
        currency: "GBP",
        status: "active",
      }]),
    });

    if (!insSub.ok) {
      const t = await insSub.text();
      return json({ ok: false, error: `Create subscription failed: ${t}` }, 500);
    }

    // 5) Mark code as used
    await fetch(`${sbUrl}/rest/v1/signup_codes?id=eq.${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        apikey: svc,
        authorization: `Bearer ${svc}`,
        prefer: "return=minimal",
      },
      body: JSON.stringify({ used_at: new Date().toISOString() }),
    });

    return json({
      ok: true,
      created: true,
      user_id,
      company_id,
      company_code
    });

  } catch (e) {
    return json({ ok: false, error: `Error: ${e?.message || e}` }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function makeToken(secret, data) {
  // HMAC-like token using SHA-256(secret|data)
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${secret}|${data}`));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function makeCompanyCode(companyName) {
  const prefix = (companyName.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 3) || "COM");
  const n = String(Math.floor(100000 + Math.random() * 900000));
  return `${prefix}${n}`;
}
