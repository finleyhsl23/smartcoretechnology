export async function onRequestPost(context) {
  try {
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_ROLE = context.env.SUPABASE_SERVICE_ROLE;
    if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL env var");
    if (!SERVICE_ROLE) throw new Error("Missing SUPABASE_SERVICE_ROLE env var");

    const body = await context.request.json();
    const { token, password } = body;
    if (!token) throw new Error("Missing token");
    if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");

    const headers = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };

    const inviteRes = await fetch(`${SUPABASE_URL}/rest/v1/smartcore_staff_invites?select=*&token=eq.${encodeURIComponent(token)}&used=eq.false&limit=1`, { headers });
    const invites = await inviteRes.json();
    if (!inviteRes.ok) throw new Error(JSON.stringify(invites));
    const invite = invites?.[0];
    if (!invite) throw new Error("Invite invalid or expired. Ask for a fresh invite.");
    if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error("Invite expired. Ask for a fresh invite.");

    let userId = null;
    const createUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: invite.email_to, password, email_confirm: true, user_metadata: { staff_id: invite.staff_id } })
    });
    const createUserText = await createUserRes.text();
    let createUserData = {};
    try { createUserData = JSON.parse(createUserText); } catch {}
    if (!createUserRes.ok) throw new Error(`Could not create auth user: ${createUserText}`);
    userId = createUserData.id || createUserData.user?.id;
    if (!userId) throw new Error("Supabase did not return auth user id");

    const staffPayload = {
      user_id: userId,
      email: invite.email_to,
      active: true,
      archived: false,
      title: emptyToNull(body.title),
      pronouns: emptyToNull(body.pronouns),
      gender: emptyToNull(body.gender),
      dob: emptyToNull(body.dob),
      nationality: emptyToNull(body.nationality),
      house_number_name: emptyToNull(body.house_number_name),
      street_name: emptyToNull(body.street_name),
      town: emptyToNull(body.town),
      postcode: emptyToNull(body.postcode),
      country: emptyToNull(body.country) || "United Kingdom",
      emergency_contact_1_name: emptyToNull(body.emergency_contact_1_name),
      emergency_contact_1_relationship: emptyToNull(body.emergency_contact_1_relationship),
      emergency_contact_1_phone: emptyToNull(body.emergency_contact_1_phone),
      emergency_contact_1_email: emptyToNull(body.emergency_contact_1_email),
      emergency_contact_2_name: emptyToNull(body.emergency_contact_2_name),
      emergency_contact_2_relationship: emptyToNull(body.emergency_contact_2_relationship),
      emergency_contact_2_phone: emptyToNull(body.emergency_contact_2_phone),
      emergency_contact_2_email: emptyToNull(body.emergency_contact_2_email)
    };

    const updateStaffRes = await fetch(`${SUPABASE_URL}/rest/v1/smartcore_staff?id=eq.${encodeURIComponent(invite.staff_id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(staffPayload)
    });
    if (!updateStaffRes.ok) throw new Error(`Staff update failed: ${await updateStaffRes.text()}`);

    const usedRes = await fetch(`${SUPABASE_URL}/rest/v1/smartcore_staff_invites?id=eq.${encodeURIComponent(invite.id)}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ used: true, used_at: new Date().toISOString() })
    });
    if (!usedRes.ok) throw new Error(`Invite close failed: ${await usedRes.text()}`);

    return json({ ok: true });
  } catch (error) {
    return json({ ok: false, error: error.message || String(error) }, 400);
  }
}
function emptyToNull(v) { const s = String(v ?? "").trim(); return s ? s : null; }
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
