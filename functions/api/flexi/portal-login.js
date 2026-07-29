import { json, handleOptions, sb, hashCode } from './_utils.js';

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }

  const trainerCode = String(body.trainer_code || '').trim().toUpperCase();
  const email = String(body.email || '').trim().toLowerCase();
  const passcode = String(body.passcode || '').trim();

  if (!trainerCode) return json({ error: 'Enter your trainer code.' }, 400);
  if (!email) return json({ error: 'Enter your email address.' }, 400);
  if (!passcode) return json({ error: 'Enter your passcode.' }, 400);

  const settingsRows = await sb(env, `/smartcore_flexi_settings?trainer_code=eq.${encodeURIComponent(trainerCode)}&select=company_id,business_name`);
  const settings = settingsRows?.[0];
  if (!settings) return json({ error: 'That trainer code was not recognised. Double-check it and try again.' }, 401);

  const clientRows = await sb(env, `/smartcore_flexi_clients?company_id=eq.${settings.company_id}&email=eq.${encodeURIComponent(email)}&select=*&limit=1`);
  const client = clientRows?.[0];
  if (!client || !client.passcode_hash) {
    return json({ error: 'No account found for that email with this trainer. Ask your trainer to check they’ve added you.' }, 401);
  }

  const providedHash = await hashCode(passcode, email);
  if (providedHash !== client.passcode_hash) {
    return json({ error: 'Incorrect passcode.' }, 401);
  }

  const session_token = crypto.randomUUID();
  const session_expires_at = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

  await sb(env, `/smartcore_flexi_clients?id=eq.${client.id}`, {
    method: 'PATCH',
    body: { session_token, session_expires_at },
  });

  return json({
    session_token,
    client: {
      id: client.id,
      company_id: client.company_id,
      trainer_id: client.trainer_id,
      full_name: client.full_name,
      email: client.email,
      status: client.status,
      business_name: settings.business_name || 'Your Trainer',
    },
  });
}
