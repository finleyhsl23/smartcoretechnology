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

  const full_name = String(body.full_name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  if (!full_name) return json({ error: 'Client name is required.' }, 400);
  if (!email || !email.includes('@')) return json({ error: 'A valid email address is required.' }, 400);

  const isAdmin = ADMIN_ROLES.includes(trainer.role);
  const trainer_id = isAdmin ? (body.trainer_id || null) : trainer.id;

  const dupe = await sb(env, `/smartcore_flexi_clients?company_id=eq.${trainer.company_id}&email=eq.${encodeURIComponent(email)}&select=id&limit=1`);
  if (dupe?.length) return json({ error: 'A client with this email already exists.' }, 409);

  const passcode = genCode(5);
  const passcode_hash = await hashCode(passcode, email);

  const [client] = await sb(env, `/smartcore_flexi_clients`, {
    method: 'POST',
    body: {
      company_id: trainer.company_id,
      trainer_id,
      full_name,
      email,
      phone: body.phone || null,
      goals: body.goals || null,
      passcode_hash,
      created_by: trainer.id,
    },
  });

  const trainerCode = await ensureTrainerCode(env, trainer.company_id);

  const settingsRows = await sb(env, `/smartcore_flexi_settings?company_id=eq.${trainer.company_id}&select=business_name,brand_color`);
  const companyRows = await sb(env, `/smartcore_core_companies?id=eq.${trainer.company_id}&select=company_name`);
  const businessName = settingsRows?.[0]?.business_name || companyRows?.[0]?.company_name || 'Your Trainer';
  const primaryColor = settingsRows?.[0]?.brand_color || '#ff5a36';

  const portalUrl = `${new URL(request.url).origin}/systems/flexi/portal/login.html`;
  const { sent } = await sendEmail(env, {
    to: email,
    subject: `Your ${businessName} login — Flexi`,
    html: welcomeEmailHtml({ businessName, primaryColor, fullName: full_name, trainerCode, email, passcode, portalUrl }),
  });

  return json({ client, passcode, trainer_code: trainerCode, emailSent: sent });
}
