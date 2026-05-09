import { json, bad, supaHeaders } from './_utils.js';
export async function onRequestPost(context) {
  try {
    const { token } = await context.request.json();
    if (!token) throw new Error('Missing token');
    const invRes = await fetch(`${context.env.SUPABASE_URL}/rest/v1/smartcore_staff_invites?token=eq.${encodeURIComponent(token)}&select=*`, { headers: supaHeaders(context.env) });
    const invites = await invRes.json(); const invite = invites?.[0];
    if (!invite) throw new Error('Invite not found');
    if (invite.used_at) throw new Error('Invite already used');
    if (new Date(invite.expires_at) < new Date()) throw new Error('Invite expired');
    const staffRes = await fetch(`${context.env.SUPABASE_URL}/rest/v1/smartcore_staff?id=eq.${invite.staff_id}&select=*`, { headers: supaHeaders(context.env) });
    const staff = (await staffRes.json())?.[0];
    if (!staff) throw new Error('Staff record not found');
    return json({ ok:true, invite, staff });
  } catch(e) { return bad(e.message || 'Verify failed', 'verify'); }
}
