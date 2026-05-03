export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    const body = await request.json();

    const to = body.to;
    const employeeName = body.employee_name || 'there';
    const onboardingUrl = body.onboarding_url;
    const expiresAt = body.expires_at;

    if (!to || !onboardingUrl) {
      return Response.json(
        { error: 'Missing email or onboarding URL.' },
        { status: 400 }
      );
    }

    if (!env.RESEND_API_KEY) {
      return Response.json(
        { error: 'RESEND_API_KEY is not set in Cloudflare Pages environment variables.' },
        { status: 500 }
      );
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || 'SmartCore Technology <support@smartcoretechnology.co.uk>',
        to,
        subject: 'Complete your Smartfits onboarding',
        html: `
          <div style="font-family:Arial,sans-serif;background:#07111f;color:#ffffff;padding:24px;">
            <div style="max-width:620px;margin:auto;background:#0b1628;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:24px;">
              <h1 style="margin-top:0;">Complete your onboarding</h1>
              <p>Hello ${employeeName},</p>
              <p>You have been invited to complete your Smartfits employee onboarding.</p>
              <p>This link expires in 12 hours.</p>
              <p>
                <a href="${onboardingUrl}" style="display:inline-block;background:#2d7cff;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:bold;">
                  Complete onboarding
                </a>
              </p>
              <p style="font-size:13px;color:#aab8d0;">Expires at: ${expiresAt || '12 hours from creation'}</p>
              <p style="font-size:13px;color:#aab8d0;">SmartCore Technology</p>
            </div>
          </div>
        `
      })
    });

    const result = await response.json();

    if (!response.ok) {
      return Response.json(
        { error: result.message || 'Resend failed.', details: result },
        { status: response.status }
      );
    }

    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      { error: error.message || 'Unable to send invite.' },
      { status: 500 }
    );
  }
}
