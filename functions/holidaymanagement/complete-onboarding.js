import { createClient } from '@supabase/supabase-js';

const SCHEMA = 'holidaymanagement';

export async function onRequestPost({ request, env }) {
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response('Missing environment variables', { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { token, user_id, full_name, phone, date_of_birth, start_date, emergency_contact_name, emergency_contact_phone } = body;

  if (!token || !user_id) {
    return new Response('token and user_id are required', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const db = supabase.schema(SCHEMA);

  // Verify token
  const { data: invite, error: inviteErr } = await db
    .from('onboarding_invites')
    .select('*')
    .eq('token', token)
    .is('used_at', null)
    .maybeSingle();

  if (inviteErr || !invite) {
    return new Response('Invalid or expired invite token', { status: 400 });
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return new Response('Invite token has expired', { status: 400 });
  }

  // Update employee record
  const { error: empErr } = await db
    .from('employees')
    .update({
      user_id,
      full_name: full_name || invite.full_name,
      phone: phone || null,
      date_of_birth: date_of_birth || null,
      start_date: start_date || null,
      emergency_contact_name: emergency_contact_name || null,
      emergency_contact_phone: emergency_contact_phone || null,
      status: 'active'
    })
    .eq('company_id', invite.company_id)
    .eq('email', invite.email);

  if (empErr) {
    return new Response('Failed to update employee: ' + empErr.message, { status: 500 });
  }

  // Mark invite as used
  await db
    .from('onboarding_invites')
    .update({ used_at: new Date().toISOString(), used_by: user_id })
    .eq('token', token);

  return Response.json({ success: true });
}
