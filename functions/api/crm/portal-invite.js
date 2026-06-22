import { hashPassword } from "./_portal_crypto.js";

export async function onRequestPost(context) {
  try {
    const SUPABASE_URL  = context.env.SUPABASE_URL;
    const SERVICE_ROLE  = context.env.SUPABASE_SERVICE_ROLE;
    const RESEND_KEY    = context.env.RESEND_API_KEY;
    const FROM_EMAIL    = context.env.RESEND_FROM || "SmartCore Technology <onboarding@smartcoretechnology.co.uk>";
    if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Missing env vars");

    const { email, password, name, crm_contact_id, crm_company_id, tenant_id } = await context.request.json();
    if (!email || !password || !tenant_id) throw new Error("email, password and tenant_id are required");
    if (password.length < 6) throw new Error("Password must be at least 6 characters");

    const password_hash = await hashPassword(password);

    const headers = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    };

    // Fetch workspace name
    const coRows = await fetch(
      `${SUPABASE_URL}/rest/v1/smartcore_core_companies?id=eq.${encodeURIComponent(tenant_id)}&select=name&limit=1`,
      { headers }
    ).then(r => r.json());
    const workspaceName = coRows?.[0]?.name || "Your Workspace";

    // Fetch the CRM company name (who invited them)
    let crmCompanyName = null;
    if (crm_company_id) {
      const ccRows = await fetch(
        `${SUPABASE_URL}/rest/v1/crm_companies?id=eq.${encodeURIComponent(crm_company_id)}&select=name&limit=1`,
        { headers }
      ).then(r => r.json());
      crmCompanyName = ccRows?.[0]?.name || null;
    }

    // Upsert portal user
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_portal_users`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        tenant_id,
        email: email.toLowerCase().trim(),
        name: name || null,
        crm_contact_id: crm_contact_id || null,
        crm_company_id: crm_company_id || null,
        password_hash,
        status: "active",
        invited_at: new Date().toISOString(),
      }),
    });

    if (!res.ok) throw new Error(`Save failed: ${await res.text()}`);
    const rows = await res.json();
    const user = Array.isArray(rows) ? rows[0] : rows;

    // Send invitation email
    if (RESEND_KEY) {
      const portalUrl = "https://smartcoretechnology.co.uk/systems/crm/portal/index.html";
      const displayName = name || email;
      const invitedByLine = crmCompanyName
        ? `<strong>${esc(crmCompanyName)}</strong> has invited you`
        : `<strong>${esc(workspaceName)}</strong> has invited you`;

      const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Inter',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1e5cff 0%,#0ea5ff 100%);border-radius:16px 16px 0 0;padding:32px 40px">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="width:40px;height:40px;background:rgba(255,255,255,0.2);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;color:#fff;letter-spacing:-0.5px;line-height:40px;text-align:center;vertical-align:middle">SC</div>
                <span style="font-size:18px;font-weight:800;color:#fff;vertical-align:middle;margin-left:10px">SmartCore</span>
              </td>
            </tr>
            <tr><td style="padding-top:24px">
              <h1 style="margin:0;font-size:24px;font-weight:800;color:#fff;line-height:1.3">You've been invited to the customer portal</h1>
            </td></tr>
          </table>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:36px 40px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">
          <p style="margin:0 0 8px;font-size:15px;color:#0f172a">Hi <strong>${esc(displayName)}</strong>,</p>
          <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.6">
            ${invitedByLine} to access the <strong>${esc(workspaceName)}</strong> customer portal on SmartCore.
            Use the details below to sign in and view your account, messages, and documents.
          </p>

          <!-- Credentials box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:28px">
            <tr><td style="padding:24px 28px">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="padding-bottom:16px">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;margin-bottom:4px">Email</div>
                    <div style="font-size:15px;font-weight:600;color:#0f172a">${esc(email)}</div>
                  </td>
                  <td width="50%" style="padding-bottom:16px">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8;margin-bottom:4px">Password</div>
                    <div style="font-size:15px;font-weight:600;color:#0f172a;font-family:'Courier New',monospace">${esc(password)}</div>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px">
            <tr><td style="background:#1e5cff;border-radius:10px">
              <a href="${portalUrl}" style="display:inline-block;padding:14px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.01em">Sign in to your portal →</a>
            </td></tr>
          </table>

          <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6">
            Or copy this link:<br>
            <a href="${portalUrl}" style="color:#1e5cff;word-break:break-all">${portalUrl}</a>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;padding:20px 40px">
          <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6">
            This invitation was sent by <strong>${esc(workspaceName)}</strong> via SmartCore Technology.<br>
            Questions? Contact your account manager or <a href="mailto:support@smartcoretechnology.co.uk" style="color:#1e5cff">support@smartcoretechnology.co.uk</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [email],
          subject: `You've been invited to ${crmCompanyName || workspaceName}'s portal on SmartCore`,
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
