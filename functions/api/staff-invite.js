import { json, bad, supaHeaders, getUserFromRequest, audit, escapeHtml } from './_utils.js';
export async function onRequestPost(context) {
  try {
    const env = context.env;
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE || !env.RESEND_API_KEY) throw new Error('Missing env vars');
    const actor = await getUserFromRequest(env, context.request);
    const { staff_id, email_to } = await context.request.json();
    if (!staff_id || !email_to) throw new Error('Missing staff_id or email_to');

    const staffRes = await fetch(`${env.SUPABASE_URL}/rest/v1/smartcore_staff?id=eq.${encodeURIComponent(staff_id)}&select=*`, { headers: supaHeaders(env) });
    const staffRows = await staffRes.json();
    const staff = staffRows?.[0];
    if (!staff) throw new Error('Staff not found');

    const token = crypto.randomUUID();
    const expires_at = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await fetch(`${env.SUPABASE_URL}/rest/v1/smartcore_staff_invites`, { method:'POST', headers:{...supaHeaders(env),Prefer:'return=minimal'}, body:JSON.stringify({ staff_id, email_to, token, expires_at, created_by: actor?.id || null }) });

    const redirectTo = `https://smartcoretechnology.co.uk/hq/onboarding.html?token=${encodeURIComponent(token)}`;
    const linkRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, { method:'POST', headers:supaHeaders(env), body:JSON.stringify({ type:'invite', email: staff.work_email, options:{ redirectTo } }) });
    if (!linkRes.ok) return bad('Supabase invite failed','generate_link',400,await linkRes.text());
    const linkData = await linkRes.json();
    const inviteLink = linkData.action_link;
    if (!inviteLink) return bad('No action_link returned','generate_link',400,linkData);
    const u = new URL(inviteLink); u.searchParams.set('redirect_to', redirectTo); const fixedLink = u.toString();

    const html = `<div style="font-family:Arial,sans-serif;color:#0b1020;line-height:1.5"><h2>Welcome to SmartCore Technology, ${escapeHtml(staff.full_name)}.</h2><p>We’re really glad to have you.</p><p>Please complete your onboarding by pressing the button below. Please note, the link below will expire in <b>12 hours</b>.</p><p><a href="${fixedLink}" style="display:inline-block;background:#1e3a8a;color:#fff;text-decoration:none;padding:12px 16px;border-radius:12px">Complete onboarding</a></p><p style="font-size:13px;color:#425070">If the button does not work, copy this link:<br><span style="word-break:break-all">${fixedLink}</span></p></div>`;
    const resend = await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:`Bearer ${env.RESEND_API_KEY}`, 'content-type':'application/json' }, body:JSON.stringify({ from: env.RESEND_FROM || 'SmartCore Technology <onboarding@smartcoretechnology.co.uk>', to:[email_to], subject:'Welcome to SmartCore Technology', html }) });
    if (!resend.ok) return bad('Resend failed','send_email',400,await resend.text());
    await audit(env, context.request, actor, 'send_staff_invite', 'smartcore_staff', staff_id, { email_to });
    return json({ ok:true });
  } catch (e) { return bad(e.message || 'Invite failed', 'exception'); }
}
