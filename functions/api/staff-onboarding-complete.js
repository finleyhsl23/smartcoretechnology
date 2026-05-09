import { json, bad, supaHeaders, audit } from './_utils.js';
export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const { token, user_id } = body;
    if (!token || !user_id) throw new Error('Missing token or user_id');
    const invRes = await fetch(`${context.env.SUPABASE_URL}/rest/v1/smartcore_staff_invites?token=eq.${encodeURIComponent(token)}&select=*`, { headers: supaHeaders(context.env) });
    const invite = (await invRes.json())?.[0];
    if (!invite || invite.used_at || new Date(invite.expires_at) < new Date()) throw new Error('Invite invalid or expired');
    const payload = { user_id, title: body.title || null, pronouns: body.pronouns || null, gender: body.gender || null, dob: body.dob || null, nationality: body.nationality || null, address: body.address || null, emergency_contact_1: body.emergency_contact_1 || {}, emergency_contact_2: body.emergency_contact_2 || {}, onboarding_completed: true, active: true, archived: false };
    const upd = await fetch(`${context.env.SUPABASE_URL}/rest/v1/smartcore_staff?id=eq.${invite.staff_id}`, { method:'PATCH', headers:{...supaHeaders(context.env),Prefer:'return=minimal'}, body:JSON.stringify(payload) });
    if (!upd.ok) return bad('Staff update failed','staff_update',400,await upd.text());
    await fetch(`${context.env.SUPABASE_URL}/rest/v1/smartcore_staff_invites?id=eq.${invite.id}`, { method:'PATCH', headers:{...supaHeaders(context.env),Prefer:'return=minimal'}, body:JSON.stringify({ used_at: new Date().toISOString() }) });
    await audit(context.env, context.request, { id:user_id }, 'staff_onboarding_complete', 'smartcore_staff', invite.staff_id, {});
    return json({ ok:true });
  } catch(e) { return bad(e.message || 'Onboarding failed', 'complete'); }
}
