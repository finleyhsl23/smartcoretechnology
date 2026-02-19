export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    const RESEND_API_KEY = context.env.RESEND_API_KEY;

    // This must be a verified sender in Resend (domain verified)
    // e.g. "SmartCore <onboarding@smartcoretechnology.co.uk>"
    const FROM_EMAIL = context.env.RESEND_FROM || "SmartCore <onboarding@smartcoretechnology.co.uk>";

    if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL env var");
    if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE env var");
    if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY env var");

    const body = await context.request.json();

    const {
      company_id,
      company_name, // optional (helps email copy)
      full_name,
      personal_email,
      job_title,

      // HR popup fields
      work_email,
      is_admin, // boolean
      status, // "active" | "archived"
      employment_type, // "Full Time" | "Part Time"
      notice_period, // e.g. "2 weeks"
      start_date, // e.g. "2026-02-19" or "19/02/2026"

      employee_code // generated on frontend
    } = body;

    // Basic validation
    if (!company_id) throw new Error("Missing company_id");
    if (!full_name) throw new Error("Missing full_name");
    if (!personal_email) throw new Error("Missing personal_email");
    if (!job_title) throw new Error("Missing job_title");
    if (!work_email) throw new Error("Missing work_email");
    if (!employee_code) throw new Error("Missing employee_code");

    const cleanStatus = String(status || "active").toLowerCase() === "archived" ? "archived" : "active";

    // 24 hours
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();

    // Where the user lands AFTER they click the invite link
    // Your onboarding page should read token=... and also handle the Supabase hash tokens
    const redirectTo =
      `https://smartcoretechnology.co.uk/onboarding?token=${encodeURIComponent(token)}`;

    // 1) Insert employee row
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/employees`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        company_id,
        full_name,
        personal_email,
        work_email,
        job_title,
        is_admin: !!is_admin,
        status: cleanStatus,
        employment_type: employment_type || null,
        notice_period: notice_period || null,
        start_date: start_date || null,
        employee_code,

        onboarding_token: token,
        onboarding_expires: expiresAt
      })
    });

    if (!insertRes.ok) {
      const t = await insertRes.text();
      throw new Error(`Employee insert failed: ${t}`);
    }

    // 2) Generate a Supabase invite link for WORK EMAIL
    // This produces an action_link the employee can click to set password securely.
    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: "invite",
        email: work_email,
        options: { redirectTo }
      })
    });

    if (!linkRes.ok) {
      const t = await linkRes.text();
      throw new Error(`Supabase generate_link failed: ${t}`);
    }

    const linkData = await linkRes.json();
    const inviteLink = linkData?.action_link;
    if (!inviteLink) throw new Error("Supabase did not return action_link");

    // 3) Email the invite link to PERSONAL EMAIL (Resend)
    const subject = `Complete your SmartCore onboarding`;
    const safeCompany = company_name || "your company";

    const html = `
      <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;color:#0b1020">
        <h2 style="margin:0 0 12px 0;">You’ve been invited to SmartCore</h2>
        <p style="margin:0 0 14px 0;">
          Hi ${escapeHtml(full_name)},<br/>
          ${safeCompany} has started your onboarding.
        </p>

        <p style="margin:0 0 14px 0;">
          Click the button below to securely set your password and complete your details.
          This link expires in <b>24 hours</b>.
        </p>

        <p style="margin:18px 0;">
          <a href="${inviteLink}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#1e3a8a;color:#fff;text-decoration:none;">
            Complete onboarding
          </a>
        </p>

        <p style="margin:18px 0 0 0;font-size:13px;color:#425070;">
          If the button doesn’t work, copy and paste this link into your browser:<br/>
          <span style="word-break:break-all;">${inviteLink}</span>
        </p>

        <p style="margin:18px 0 0 0;font-size:13px;color:#425070;">
          Support: <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a>
        </p>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [personal_email],
        subject,
        html
      })
    });

    if (!resendRes.ok) {
      const t = await resendRes.text();
      throw new Error(`Resend failed: ${t}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || "Unknown error" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// tiny helper
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
