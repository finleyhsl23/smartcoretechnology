import { json, handleOptions, sb, genCode, hashCode, welcomeEmailHtml, sendEmail, getTrainerProfile, ensureTrainerCode } from './_utils.js';

const ADMIN_ROLES = ['owner', 'admin', 'administrator'];

export async function onRequestOptions() {
  return handleOptions();
}

export async function onRequestPost({ request, env }) {
  const trainer = await getTrainerProfile(request, env);
  if (!trainer) return json({ error: 'Unauthorised' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request body' }, 400); }
  const clientId = body.client_id;
  if (!clientId) return json({ error: 'client_id is required.' }, 400);

  const rows = await sb(env, `/smartcore_flexi_clients?id=eq.${clientId}&select=*&limit=1`);
  const client = rows?.[0];
  if (!client || client.company_id !== trainer.company_id) return json({ error: 'Client not found.' }, 404);

  const isAdmin = ADMIN_ROLES.includes(trainer.role);
  if (!isAdmin && client.trainer_id && client.trainer_id !== trainer.id) {
    return json({ error: 'You can only resend codes for your own clients.' }, 403);
  }

  const passcode = genCode(5);
  const passcode_hash = await hashCode(passcode, client.email);
  await sb(env, `/smartcore_flexi_clients?id=eq.${clientId}`, { method: 'PATCH', body: { passcode_hash } });

  const trainerCode = await ensureTrainerCode(env, trainer.company_id);
  const settingsRows = await sb(env, `/smartcore_flexi_settings?company_id=eq.${trainer.company_id}&select=business_name,brand_color`);
  const companyRows = await sb(env, `/smartcore_core_companies?id=eq.${trainer.company_id}&select=company_name`);
  const businessName = settingsRows?.[0]?.business_name || companyRows?.[0]?.company_name || 'Your Trainer';
  const primaryColor = settingsRows?.[0]?.brand_color || '#ff5a36';

  const portalUrl = `${new URL(request.url).origin}/systems/flexi/portal/login.html`;
  const { sent } = await sendEmail(env, {
    to: client.email,
    subject: `Your ${businessName} login — Flexi`,
    html: welcomeEmailHtml({ businessName, primaryColor, fullName: client.full_name, trainerCode, email: client.email, passcode, portalUrl }),
  });

  return json({ passcode, trainer_code: trainerCode, emailSent: sent });
}
