import { verifyPassword, signJWT } from "./_portal_crypto.js";

export async function onRequestPost(context) {
  try {
    const SUPABASE_URL  = context.env.SUPABASE_URL;
    const SERVICE_ROLE  = context.env.SUPABASE_SERVICE_ROLE;
    const JWT_SECRET    = context.env.PORTAL_JWT_SECRET || "smartcore-portal-default-secret-change-me";
    if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Missing env vars");

    const { email, password } = await context.request.json();
    if (!email || !password) throw new Error("Email and password required");

    const headers = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
    };

    // Look up portal user by email
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_portal_users?email=eq.${encodeURIComponent(email.toLowerCase().trim())}&select=id,email,name,status,password_hash,tenant_id,crm_contact_id&limit=1`,
      { headers }
    );
    const rows = await res.json();
    const user = rows?.[0];

    if (!user || !user.password_hash) {
      return json({ ok: false, error: "Invalid email or password" }, 401);
    }
    if (user.status === "suspended") {
      return json({ ok: false, error: "Your portal access has been suspended. Contact your account manager." }, 403);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return json({ ok: false, error: "Invalid email or password" }, 401);
    }

    // Update last_login_at
    await fetch(
      `${SUPABASE_URL}/rest/v1/crm_portal_users?id=eq.${user.id}`,
      { method: "PATCH", headers, body: JSON.stringify({ last_login_at: new Date().toISOString() }) }
    );

    const now = Math.floor(Date.now() / 1000);
    const token = await signJWT({
      sub: user.id,
      tid: user.tenant_id,
      email: user.email,
      name: user.name || user.email,
      cid: user.crm_contact_id || null,
      iat: now,
      exp: now + 60 * 60 * 24 * 7, // 7 days
    }, JWT_SECRET);

    return json({ ok: true, token, user: { id: user.id, email: user.email, name: user.name, tenant_id: user.tenant_id, crm_contact_id: user.crm_contact_id } });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 400);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
