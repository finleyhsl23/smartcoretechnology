export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));

    const purpose = String(body.purpose || "owner_signup"); // owner_signup | employee_signup
    const email = String(body.email || "").trim().toLowerCase();
    const code = String(body.code || "").trim();

    if (!email) return new Response("Missing email", { status: 400 });
    if (!code || code.length !== 6) return new Response("Invalid code", { status: 400 });

    if (!env.SUPABASE_URL) return new Response("Missing SUPABASE_URL env var", { status: 500 });
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return new Response("Missing SUPABASE_SERVICE_ROLE_KEY env var", { status: 500 });
    if (!env.CODE_SALT) return new Response("Missing CODE_SALT env var", { status: 500 });

    // hash the code
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(code + env.CODE_SALT));
    const code_hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

    // look up latest code
    const qs = new URL(`${env.SUPABASE_URL}/rest/v1/signup_codes`);
    qs.searchParams.set("select", "id,expires_at,used_at,purpose,company_code");
    qs.searchParams.set("email", `eq.${email}`);
    qs.searchParams.set("code_hash", `eq.${code_hash}`);
    qs.searchParams.set("order", "created_at.desc");
    qs.searchParams.set("limit", "1");

    const codeRes = await fetch(qs.toString(), {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      }
    });

    if (!codeRes.ok) return new Response(`Code lookup failed: ${await codeRes.text()}`, { status: 500 });

    const rows = await codeRes.json();
    const row = rows?.[0];
    if (!row) return new Response("Invalid code", { status: 400 });
    if (row.used_at) return new Response("Code already used", { status: 400 });
    if (new Date(row.expires_at).getTime() < Date.now()) return new Response("Code expired", { status: 400 });
    if (row.purpose && row.purpose !== purpose) return new Response("Wrong code purpose", { status: 400 });

    // mark used
    await fetch(`${env.SUPABASE_URL}/rest/v1/signup_codes?id=eq.${row.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ used_at: new Date().toISOString() }),
    });

    // OWNER SIGNUP
    if (purpose === "owner_signup") {
      const password = String(body.password || "");
      const company_name = String(body.company_name || "").trim();

      const company_size = body.company_size; // {id,label,price_gbp}
      const module_ids = Array.isArray(body.module_ids) ? body.module_ids : [];

      if (!company_name) return new Response("Missing company name", { status: 400 });
      if (!password || password.length < 8) return new Response("Password too short", { status: 400 });
      if (!company_size?.id) return new Response("Missing company size", { status: 400 });

      // Create user (admin)
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
          email_confirm: true,
          user_metadata: { role: "owner" },
        }),
      });

      if (!createUserRes.ok) return new Response(`Create user failed: ${await createUserRes.text()}`, { status: 500 });
      const created = await createUserRes.json();
      const user_id = created?.user?.id;
      if (!user_id) return new Response("Create user failed (no id)", { status: 500 });

      // Generate company_code via RPC if you have it, otherwise fallback
      let company_code = null;
      const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/make_company_code`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ company_name }),
      });

      if (rpcRes.ok) {
        company_code = await rpcRes.json();
      } else {
        // fallback code if rpc isn't present
        const prefix = company_name.replace(/[^a-z]/gi, "").toUpperCase().padEnd(3, "X").slice(0, 3);
        company_code = prefix + String(Math.floor(100000 + Math.random() * 900000));
      }

      // Create company (NOTE: uses your existing column company_name)
      const compRes = await fetch(`${env.SUPABASE_URL}/rest/v1/companies`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
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

      // Total for testing
      const prices = {
        presence_fire: 10,
        policies_handbook: 7,
        holiday_booking: 8,
        accident_injury: 3,
        training_compliance: 9,
        onboarding_offboarding: 8,
        expenses_upload: 6,
        wellbeing_check: 4
      };
      const module_total = module_ids.reduce((sum, id) => sum + (prices[id] || 0), 0);
      const total_gbp = Number(company_size.price_gbp || 0) + module_total;

      // Create subscription
      const subRes = await fetch(`${env.SUPABASE_URL}/rest/v1/subscriptions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          prefer: "return=minimal",
        },
        body: JSON.stringify([{
          company_id,
          company_size_id: company_size.id,
          company_size_label: company_size.label,
          company_size_price_gbp: Number(company_size.price_gbp || 0),
          selected_module_ids: module_ids,
          total_gbp,
          status: "active",
        }]),
      });

      if (!subRes.ok) return new Response(`Create subscription failed: ${await subRes.text()}`, { status: 500 });

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });

  } catch (e) {
    return new Response(`Error: ${e?.message || e}`, { status: 500 });
  }
}
