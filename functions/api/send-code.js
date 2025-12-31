export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const purpose = String(body.purpose || "owner_signup");
    const company_code = body.company_code ? String(body.company_code).trim().toUpperCase() : null;
    const full_name = body.full_name ? String(body.full_name).trim() : null;

    if (!email) return new Response(JSON.stringify({ ok:false, error:"Missing email" }), { status: 400 });
    if (!env.RESEND_API_KEY) return new Response(JSON.stringify({ ok:false, error:"Missing RESEND_API_KEY env var" }), { status: 500 });
    if (!env.SUPABASE_URL) return new Response(JSON.stringify({ ok:false, error:"Missing SUPABASE_URL env var" }), { status: 500 });
    if (!env.SUPABASE_SERVICE_ROLE_KEY) return new Response(JSON.stringify({ ok:false, error:"Missing SUPABASE_SERVICE_ROLE_KEY env var" }), { status: 500 });
    if (!env.CODE_SALT) return new Response(JSON.stringify({ ok:false, error:"Missing CODE_SALT env var" }), { status: 500 });

    // If employee signup, validate employee exists first
    if (purpose === "employee_signup") {
      if (!company_code) return new Response(JSON.stringify({ ok:false, error:"Missing company_code" }), { status: 400 });
      if (!full_name) return new Response(JSON.stringify({ ok:false, error:"Missing full_name" }), { status: 400 });

      // Find company by code
      const coRes = await fetch(`${env.SUPABASE_URL}/rest/v1/companies?select=id,company_name,company_code&company_code=eq.${encodeURIComponent(company_code)}&limit=1`, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        }
      });
      const coArr = await coRes.json().catch(()=>[]);
      const company = coArr?.[0];
      if (!company) {
        return new Response(JSON.stringify({
          ok:false,
          error:"We couldn’t find that company code. Please double-check it or contact your system admin."
        }), { status: 400 });
      }

      // Check employee name exists in employees table for that company
      const empRes = await fetch(`${env.SUPABASE_URL}/rest/v1/employees?select=id,full_name&company_id=eq.${company.id}&full_name=ilike.${encodeURIComponent(full_name)}&limit=1`, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        }
      });
      const empArr = await empRes.json().catch(()=>[]);
      const found = empArr?.[0];
      if (!found) {
        return new Response(JSON.stringify({
          ok:false,
          error:"We couldn’t find your details attached to this company yet. Please contact your system admin to confirm you’ve been added as an employee."
        }), { status: 400 });
      }
    }

    // Generate code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Hash
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(code + env.CODE_SALT));
    const code_hash = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");

    // Store code row
    const ins = await fetch(`${env.SUPABASE_URL}/rest/v1/signup_codes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        prefer: "return=minimal"
      },
      body: JSON.stringify([{
        email,
        code_hash,
        purpose,
        company_code,
        full_name,
        expires_at
      }])
    });

    if (!ins.ok) {
      const t = await ins.text();
      return new Response(JSON.stringify({ ok:false, error:`Supabase insert failed: ${t}` }), { status: 500 });
    }

    const from = env.RESEND_FROM || "SmartCore Technology <support@smartcoretechnology.co.uk>";
    const subject = purpose === "employee_signup"
      ? "Your SmartCore employee verification code"
      : "Your SmartCore verification code";

    const html = `
      <div style="font-family:Inter,system-ui,Segoe UI,Arial;line-height:1.6">
        <h2 style="margin:0 0 12px 0">SmartCore Technology</h2>
        <p style="margin:0 0 12px 0">Your verification code is:</p>
        <div style="font-size:28px;font-weight:800;letter-spacing:6px;background:#0b1020;color:#fff;padding:14px 16px;border-radius:12px;display:inline-block;border:1px solid rgba(255,255,255,.12)">
          ${code}
        </div>
        <p style="margin:12px 0 0 0;color:#666">This code expires in 10 minutes.</p>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ from, to: [email], subject, html })
    });

    if (!resendRes.ok) {
      const t = await resendRes.text();
      return new Response(JSON.stringify({ ok:false, error:`Resend failed: ${t}` }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok:true }), {
      headers: { "content-type":"application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:`Error: ${e?.message || e}` }), { status: 500 });
  }
}
