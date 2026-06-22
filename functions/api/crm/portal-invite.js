import { hashPassword } from "./_portal_crypto.js";

export async function onRequestPost(context) {
  try {
    const SUPABASE_URL  = context.env.SUPABASE_URL;
    const SERVICE_ROLE  = context.env.SUPABASE_SERVICE_ROLE;
    const RESEND_KEY    = context.env.RESEND_API_KEY;
    const FROM_EMAIL    = context.env.RESEND_FROM || "SmartCore Technology <onboarding@smartcoretechnology.co.uk>";
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

    // Fetch company name for the invitation email
    const coRows = await fetch(
      `${SUPABASE_URL}/rest/v1/smartcore_core_companies?id=eq.${encodeURIComponent(tenant_id)}&select=name&limit=1`,
      { headers }
    ).then(r => r.json());
    const companyName = coRows?.[0]?.name || "your workspace";

    // Upsert portal user
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

    // Send invitation email via Resend
    if (RESEND_KEY) {
      const portalUrl = "https://smartcoretechnology.co.uk/systems/crm/portal/index.html";
      const greeting  = name ? `Hi ${esc(name)},` : "Hi there,";
      const html = `
        <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0b1020;max-width:560px;margin:0 auto">
          <div style="background:linear-gradient(135deg,#1e5cff,#0ea5ff);border-radius:14px 14px 0 0;padding:28px 32px">
            <div style="font-size:22px;font-weight:900;color:#fff">SC SmartCore</div>
          </div>
          <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:32px">
            <p style="font-size:16px;font-weight:700;margin:0 0 8px">${greeting}</p>
            <p style="margin:0 0 20px;color:#374151">
              You've been invited to access the <strong>${esc(companyName)}</strong> customer portal on SmartCore.
              Use the details below to sign in.
            </p>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin-bottom:24px">
              <div style="margin-bottom:10px">
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Email</span><br>
                <span style="font-size:15px;font-weight:600;color:#111827">${esc(email)}</span>
              </div>
              <div>
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Password</span><br>
                <span style="font-size:15px;font-weight:600;color:#111827;font-family:monospace">${esc(password)}</span>
              </div>
            </div>
            <a href="${portalUrl}" style="display:inline-block;background:#1e5cff;color:#fff;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:700;font-size:14px">
              Sign in to your portal →
            </a>
            <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">
              If you have any questions, contact your account manager.<br>
              <a href="${portalUrl}" style="color:#6b7280">${portalUrl}</a>
            </p>
          </div>
        </div>`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [email],
          subject: `You've been invited to ${companyName} on SmartCore`,
          html,
        }),
      });
    }

    return json({ ok: true, user });
  } catch (err) {
    return json({ ok: false, error: err.message || String(err) }, 400);
  }
}

function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
