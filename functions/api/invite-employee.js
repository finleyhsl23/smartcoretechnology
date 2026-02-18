export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));

    const email = String(body.email || "").trim().toLowerCase();
    const redirect_to = String(body.redirect_to || "").trim();
    const company_id = body.company_id ?? null;
    const employee_code = String(body.employee_code || "").trim();

    if (!email) return json({ error: "Missing email" }, 400);
    if (!redirect_to) return json({ error: "Missing redirect_to" }, 400);
    if (!env.SUPABASE_URL) return json({ error: "Missing SUPABASE_URL env var" }, 500);
    if (!env.SUPABASE_SERVICE_ROLE) return json({ error: "Missing SUPABASE_SERVICE_ROLE env var" }, 500);

    // Supabase Admin Invite endpoint
    const url = `${env.SUPABASE_URL}/auth/v1/admin/users`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": env.SUPABASE_SERVICE_ROLE,
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE}`
      },
      body: JSON.stringify({
        email,
        invite: true,
        // metadata available in JWT/user metadata
        user_metadata: { company_id, employee_code },
        // where the invite link should return
        redirect_to
      })
    });

    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!res.ok) {
      const msg = data?.msg || data?.error_description || data?.error || text;
      return json({ error: msg }, 400);
    }

    return json({ ok: true, invited: true, user: data }, 200);

  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
