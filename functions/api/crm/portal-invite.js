import { hashPassword } from "./_portal_crypto.js";

export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Missing env vars");

    const { email, password, name, crm_contact_id, tenant_id } = await context.request.json();
    if (!email || !password || !tenant_id) throw new Error("email, password and tenant_id are required");
    if (password.length < 6) throw new Error("Password must be at least 6 characters");

    const password_hash = await hashPassword(password);

    const headers = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_portal_users`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tenant_id,
        email: email.toLowerCase().trim(),
        name: name || null,
        crm_contact_id: crm_contact_id || null,
        password_hash,
        status: "active",
        invited_at: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Save failed: ${t}`);
    }

    const rows = await res.json();
    const user = Array.isArray(rows) ? rows[0] : rows;
    return json({ ok: true, user });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 400);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
