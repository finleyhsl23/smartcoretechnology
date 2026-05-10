export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    const RESEND_API_KEY = context.env.RESEND_API_KEY;
    const FROM_EMAIL = context.env.RESEND_FROM || "SmartCore <onboarding@smartcoretechnology.co.uk>";

    if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL env var");
    if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE env var");
    if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY env var");

    const body = await context.request.json();
    const staff_id = body.staff_id;
    const email_to = body.email_to;
    if (!staff_id || !email_to) throw new Error("Missing staff_id or email_to");

    const headers = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json"
    };

    const staffRes = await fetch(`${SUPABASE_URL}/rest/v1/smartcore_staff?id=eq.${encodeURIComponent(staff_id)}&select=*`, { headers });
    if (!staffRes.ok) throw new Error(await staffRes.text());
    const staffRows = await staffRes.json();
    const staff = staffRows[0];
    if (!staff) throw new Error("Staff row not found");

    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/smartcore_staff?id=eq.${encodeURIComponent(staff_id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ onboarding_token: token, onboarding_expires: expires })
    });
    if (!patchRes.ok) throw new Error(await patchRes.text());

    const link = `https://smartcoretechnology.co.uk/onboarding.html?staff_token=${encodeURIComponent(token)}`;
    const html = `
      <div style="font-family:Inter,Arial,sans-serif;line-height:1.5;color:#0b1020">
        <h2>Welcome to SmartCore Technology, ${escapeHtml(staff.full_name || "")}</h2>
        <p>We’re really glad to have you.</p>
        <p>Please complete your onboarding by pressing the button below. Please note, this link will expire in <b>12 hours</b>.</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#1e3a8a;color:#fff;text-decoration:none">Complete onboarding</a></p>
        <p style="font-size:13px;color:#425070">If the button does not work, copy this link:<br>${link}</p>
      </div>`;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [email_to], subject: "Welcome to SmartCore Technology", html })
    });
    const emailText = await emailRes.text();
    if (!emailRes.ok) throw new Error(emailText);

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: e.message || String(e) }, 400);
  }
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
function escapeHtml(s) { return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
