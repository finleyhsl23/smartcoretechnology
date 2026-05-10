export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    const RESEND_API_KEY = context.env.RESEND_API_KEY;
    const FROM_EMAIL = context.env.RESEND_FROM || 'SmartCore <onboarding@smartcoretechnology.co.uk>';

    if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL env var');
    if (!SERVICE_ROLE) throw new Error('Missing SUPABASE_SERVICE_ROLE env var');
    if (!RESEND_API_KEY) throw new Error('Missing RESEND_API_KEY env var');

    const body = await context.request.json();
    const staff_id = String(body.staff_id || '').trim();
    const email_to = String(body.email_to || '').trim().toLowerCase();

    if (!staff_id || !email_to) throw new Error('Missing staff_id or email_to');

    const adminHeaders = {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json'
    };

    const staffRes = await fetch(`${SUPABASE_URL}/rest/v1/smartcore_staff?id=eq.${encodeURIComponent(staff_id)}&select=*`, {
      headers: adminHeaders
    });

    if (!staffRes.ok) throw new Error(await staffRes.text());
    const staffRows = await staffRes.json();
    const staff = staffRows?.[0];
    if (!staff) throw new Error('Staff record not found');

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();

    await fetch(`${SUPABASE_URL}/rest/v1/smartcore_staff?id=eq.${encodeURIComponent(staff_id)}`, {
      method: 'PATCH',
      headers: { ...adminHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ onboarding_token: token, onboarding_expires: expiresAt })
    });

    const redirectTo = `https://smartcoretechnology.co.uk/onboarding.html?staff_token=${encodeURIComponent(token)}`;

    const linkRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        type: 'invite',
        email: staff.work_email || staff.email || email_to,
        options: { redirectTo }
      })
    });

    if (!linkRes.ok) throw new Error('Supabase invite failed: ' + await linkRes.text());
    const linkData = await linkRes.json();
    const inviteLink = linkData.action_link;
    if (!inviteLink) throw new Error('Supabase did not return an invite link');

    const u = new URL(inviteLink);
    u.searchParams.set('redirect_to', redirectTo);
    const finalLink = u.toString();

    const html = `
      <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.5;color:#0b1020">
        <h2 style="margin:0 0 12px 0;">Welcome to SmartCore Technology, ${escapeHtml(staff.full_name || '')}</h2>
        <p style="margin:0 0 14px 0;">We’re really glad to have you.</p>
        <p style="margin:0 0 14px 0;">Please complete your onboarding by pressing the button below. Please note, this link expires in <b>12 hours</b>.</p>
        <p style="margin:18px 0;"><a href="${finalLink}" style="display:inline-block;padding:12px 16px;border-radius:12px;background:#1e3a8a;color:#fff;text-decoration:none;font-weight:700;">Complete onboarding</a></p>
        <p style="font-size:13px;color:#425070;word-break:break-all;">If the button doesn’t work, copy this link:<br>${finalLink}</p>
        <p style="font-size:13px;color:#425070;">Support: <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a></p>
      </div>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [email_to], subject: 'Complete your SmartCore onboarding', html })
    });

    const resendText = await resendRes.text();
    if (!resendRes.ok) throw new Error('Resend failed: ' + resendText);

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err?.message || String(err) }, 400);
  }
}
function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }); }
function escapeHtml(s) { return String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
