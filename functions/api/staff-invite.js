export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    const RESEND_API_KEY = context.env.RESEND_API_KEY;
    const FROM_EMAIL = context.env.RESEND_FROM || "SmartCore Technology <onboarding@smartcoretechnology.co.uk>";

    if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL env var");
    if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE env var");
    if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY env var");

    const body = await context.request.json();
    const staff_id = body.staff_id || body.staffId || body.id;
    const email_to = body.email_to || body.emailTo || body.email;
    const full_name = body.full_name || "";

    if (!staff_id) throw new Error("Missing staff_id");
    if (!email_to) throw new Error("Missing email_to");

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

    const headers = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json"
    };

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/smartcore_staff_invites`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ staff_id, email_to, token, expires_at: expiresAt, used: false })
    });

    if (!insertRes.ok) {
      const t = await insertRes.text();
      throw new Error(`Invite save failed: ${t}`);
    }

    const link = `https://smartcoretechnology.co.uk/onboarding.html?token=${encodeURIComponent(token)}`;
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#0b1020">
        <h2>Welcome to SmartCore Technology${full_name ? `, ${escapeHtml(full_name)}` : ""}</h2>
        <p>We're really glad to have you.</p>
        <p>Please complete your onboarding by pressing the button below. Please note, the link below will expire in <b>12 hours</b>.</p>
        <p style="margin:20px 0"><a href="${link}" style="background:#1d4ed8;color:#fff;padding:12px 18px;border-radius:12px;text-decoration:none;display:inline-block;font-weight:700">Complete onboarding</a></p>
        <p style="font-size:13px;color:#425070">If the button doesn't work, copy this link:<br><span style="word-break:break-all">${link}</span></p>
        <p style="font-size:13px;color:#425070">Support: support@smartcoretechnology.co.uk</p>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [email_to], subject: "Complete your SmartCore onboarding", html })
    });

    const resendText = await resendRes.text();
    if (!resendRes.ok) throw new Error(`Resend failed: ${resendText}`);

    return json({ ok: true, email_to, link });
  } catch (error) {
    return json({ ok: false, error: error.message || String(error) }, 400);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
function escapeHtml(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
