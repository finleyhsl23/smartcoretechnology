import { createClient } from "@supabase/supabase-js";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));

    const email = String(body.email || "").trim().toLowerCase();
    const redirect_to = String(body.redirect_to || "").trim();
    const company_id = body.company_id;
    const employee_code = String(body.employee_code || "").trim();

    if (!email) return json({ error: "Missing email" }, 400);
    if (!redirect_to) return json({ error: "Missing redirect_to" }, 400);
    if (!env.SUPABASE_URL) return json({ error: "Missing SUPABASE_URL env var" }, 500);
    if (!env.SUPABASE_SERVICE_ROLE) return json({ error: "Missing SUPABASE_SERVICE_ROLE env var" }, 500);

    // Service-role client (server-side only)
    const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE);

    // Invite email (Supabase sends an email with a secure set-password link)
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirect_to,
      data: {
        company_id,
        employee_code
      }
    });

    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, invited: true, user: data?.user ?? null }, 200);

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
