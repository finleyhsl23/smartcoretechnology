export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL env var");
    if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE env var");

    const { token } = await context.request.json();
    if (!token) throw new Error("Missing token");

    const headers = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };
    const url = `${SUPABASE_URL}/rest/v1/smartcore_staff_invites?select=id,staff_id,email_to,expires_at,used,smartcore_staff(full_name,work_email,email)&token=eq.${encodeURIComponent(token)}&limit=1`;
    const res = await fetch(url, { headers });
    const rows = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(rows));
    const invite = rows?.[0];
    if (!invite || invite.used || new Date(invite.expires_at).getTime() < Date.now()) return json({ ok: true, invite: null });

    return json({ ok: true, invite: { id: invite.id, staff_id: invite.staff_id, email_to: invite.email_to, expires_at: invite.expires_at, full_name: invite.smartcore_staff?.full_name || "" } });
  } catch (error) {
    return json({ ok: false, error: error.message || String(error) }, 400);
  }
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
