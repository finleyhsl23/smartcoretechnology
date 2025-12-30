export async function onRequestGet() {
  return new Response("verify-code ok (POST required)", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));

    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();
    const password = String(body.password || "");

    const purpose = String(body.purpose || "owner_signup").trim(); // owner_signup | employee_signup
    const company_name = String(body.company_name || "").trim();
    const company_size = body.company_size || null;
    const module_ids = Array.isArray(body.module_ids) ? body.module_ids : [];

    if (!email) return new Response("Missing email", { status: 400 });
    if (!code || code.length !== 6) return new Response("Missing/invalid code", { status: 400 });
    if (!password || password.length < 8) return new Response("Password must be at least 8 characters", { status: 400 });

    const SUPABASE_URL = String(env.SUPABASE_URL || "").trim();
    const SERVICE = String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    const CODE_SALT = String(env.CODE_SALT || "").trim();

    if (!SUPABASE_URL) return new Response("Missing SUPABASE_URL env var", { status: 500 });
    if (!SERVICE) return new Response("Missing SUPABASE_SERVICE_ROLE_KEY env var", { status: 500 });
    if (!CODE_SALT) return new Response("Missing CODE_SALT env var", { status: 500 });

    // ---- Hash code ----
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(code + CODE_SALT));
    const code_hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // ---- Look up code row ----
    const lookupUrl =
      `${SUPABASE_URL}/rest/v1/signup_codes` +
      `?select=id,email,code_hash,purpose,expires_at,used_at` +
      `&email=eq.${encodeURIComponent(email)}` +
      `&code_hash=eq.${code_hash}` +
      `&order=created_at.desc&limit=1`;

    const lookupRes = await fetch(lookupUrl, {
      headers: {
        apikey: SERVICE,
        authorization: `Bearer ${SERVICE}`,
      },
    });

    if (!lookupRes.ok) {
      return new Response(`Supabase lookup failed: ${await lookupRes.text()}`, { status: 500 });
    }

    const rows = await lookupRes.json();
    const row = rows?.[0];

    if (!row) return new Response("Invalid code", { status: 400 });
    if (row.used_at) return new Response("Code already used", { status: 400 });

    const exp = new Date(row.expires_at).getTime();
    if (Number.isFinite(exp) && exp < Date.now()) return new Response("Code expired", { status: 400 });

    if (row.purpose && row.purpose !== purpose) return new Response("Wrong code type", { status: 400 });

    // ---- Mark code used FIRST (prevents race) ----
    const markRes = await fetch(`${SUPABASE_URL}/rest/v1/signup_codes?id=eq.${row.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        apikey: SERVICE,
        authorization: `Bearer ${SERVICE}`,
      },
      body: JSON.stringify({ used_at: new Date().toISOString() }),
    });

    if (!markRes.ok) {
      return new Response(`Failed to mark code used: ${await markRes.text()}`, { status: 500 });
    }

    // ---- Create user ONLY AFTER code verified ----
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        apikey: SERVICE,
        authorization: `Bearer ${SERVICE}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: "owner" },
      }),
    });

    const createText = await createRes.text();
    if (!createRes.ok) {
      return new Response(`Create user failed: ${createText}`, { status: 500 });
    }

    let created;
    try {
      created = JSON.parse(createText || "{}");
    } catch {
      return new Response(`Create user returned non-JSON: ${createText}`, { status: 500 });
    }

    // Supabase can return different shapes; handle all
    const user_id =
      created?.id ||
      created?.user?.id ||
      created?.data?.user?.id ||
      created?.data?.id;

    if (!user_id) {
      return new Response(
        `Create user succeeded but no id returned.\nRaw response: ${createText}`,
        { status: 500 }
      );
    }

    // ---- Create company + subscription (owner flow) ----
    if (purpose === "owner_signup") {
      if (!company_name) return new Response("Missing company_name", { status: 400 });
      if (!company_size?.id) return new Response("Missing company_size", { status: 400 });

      // company code
      let company_code = null;
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/make_company_code`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: SERVICE,
          authorization: `Bearer ${SERVICE}`,
        },
        body: JSON.stringify({ company_name }),
      });

      if (rpcRes.ok) company_code = await rpcRes.json();
      if (!company_code) {
        const prefix = company_name.replace(/[^a-z]/gi, "").toUpperCase().padEnd(3, "X").slice(0, 3);
        company_code = prefix + String(Math.floor(100000 + Math.random() * 900000));
      }

      // create company
      const compRes = await fetch(`${SUPABASE_URL}/rest/v1/companies`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: SERVICE,
          authorization: `Bearer ${SERVICE}`,
          prefer: "return=representation",
        },
        body: JSON.stringify([{
          owner_user_id: user_id,
          company_code,
          company_name,
        }]),
      });

      if (!compRes.ok) return new Response(`Create company failed: ${await compRes.text()}`, { status: 500 });
      const compRows = await compRes.json();
      const company_id = compRows?.[0]?.id;
      if (!company_id) return new Response("Create company failed (no company_id)", { status: 500 });

      // create subscription
      const subRes = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: SERVICE,
          authorization: `Bearer ${SERVICE}`,
          prefer: "return=minimal",
        },
        body: JSON.stringify([{
          company_id,
          company_size_id: company_size.id,
          company_size_label: company_size.label,
          company_size_price_gbp: Number(company_size.price_gbp || 0),
          selected_module_ids: module_ids,
          status: "active",
        }]),
      });

      if (!subRes.ok) return new Response(`Create subscription failed: ${await subRes.text()}`, { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, user_id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  } catch (e) {
    return new Response(`Error: ${e?.message || e}`, { status: 500 });
  }
}
