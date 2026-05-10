export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    const RESEND_API_KEY = context.env.RESEND_API_KEY;
    const FROM_EMAIL = context.env.RESEND_FROM || "SmartCore <onboarding@smartcoretechnology.co.uk>";
    if (!SUPABASE_URL || !SERVICE_ROLE || !RESEND_API_KEY) throw new Error("Missing env vars");

    const { staff_id, email_to } = await context.request.json();
    if (!staff_id || !email_to) throw new Error("Missing staff_id or email_to");

    const headers = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };
    const staffRes = await fetch(`${SUPABASE_URL}/rest/v1/smartcore_staff?id=eq.${encodeURIComponent(staff_id)}&select=*`, { headers });
    const staffList = await staffRes.json();
    const staff = staffList?.[0];
    if (!staff) throw new Error("Staff member not found");

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/smartcore_staff?id=eq.${encodeURIComponent(staff_id)}`, {
      method: "PATCH", headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ onboarding_token: token, onboarding_expires: expiresAt })
    });

    const redirectTo = `https://smartcoretechnology.co.uk/onboarding.html?token=${encodeURIComponent(token)}`;
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST", headers,
      body: JSON.stringify({ type: "invite", email: staff.work_email || staff.email || email_to, options: { redirectTo } })
    });
    const linkText = await linkRes.text();
    if (!linkRes.ok) return json({ ok:false, error:"Supabase invite failed", details: linkText }, 400);
    const linkData = JSON.parse(linkText);
    const u = new URL(linkData.action_link);
    u.searchParams.set("redirect_to", redirectTo);
    const inviteLink = u.toString();

    const html = `<div style="font-family:Inter,Arial;line-height:1.5;color:#0b1020"><h2>Welcome to SmartCore Technology, ${escapeHtml(staff.full_name || "")}</h2><p>We're really glad to have you.</p><p>Please complete your onboarding by pressing the button below. Please note, the link below will expire in <b>12 hours</b>.</p><p><a href="${inviteLink}" style="display:inline-block;background:#1e3a8a;color:white;padding:12px 16px;border-radius:12px;text-decoration:none">Complete onboarding</a></p><p style="font-size:13px;color:#425070;word-break:break-all">${inviteLink}</p></div>`;
    const resend = await fetch("https://api.resend.com/emails", { method:"POST", headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, "Content-Type":"application/json" }, body: JSON.stringify({ from: FROM_EMAIL, to:[email_to], subject:"Welcome to SmartCore Technology", html }) });
    const resendText = await resend.text();
    if (!resend.ok) return json({ ok:false, error:"Resend failed", details:resendText }, 400);
    return json({ ok:true });
  } catch (e) { return json({ ok:false, error:e.message || String(e) }, 400); }
}
function json(obj,status=200){return new Response(JSON.stringify(obj),{status,headers:{"Content-Type":"application/json"}})}
function escapeHtml(s){return String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}

