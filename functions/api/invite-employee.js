export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    const {
      company_id,
      full_name,
      personal_email,
      work_email,
      job_title,
      is_admin,
      status,
      employment_type,
      notice_period,
      start_date,
      employee_code,
      onboarding_url_base
    } = body;

    if (!company_id) throw new Error("Missing company_id");
    if (!full_name) throw new Error("Missing full_name");
    if (!personal_email) throw new Error("Missing personal_email");
    if (!work_email) throw new Error("Missing work_email");
    if (!employee_code) throw new Error("Missing employee_code");

    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      throw new Error("Server not configured");
    }

    // 🔐 Create onboarding token
    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h

    // 🗄 Insert employee
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/employees`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_ROLE,
        "Authorization": `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        company_id,
        full_name,
        personal_email,
        work_email,
        job_title,
        is_admin,
        status,
        employment_type,
        notice_period,
        start_date,
        employee_code,
        onboarding_token: token,
        onboarding_expires: expires.toISOString()
      })
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      throw new Error(errText);
    }

    // 📩 SEND EMAIL (replace with Resend / SendGrid later)
    const onboardingLink = `${onboarding_url_base}?token=${token}`;

    console.log("Send this email to:", personal_email);
    console.log("Onboarding link:", onboardingLink);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message || "Unknown error"
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }
}
