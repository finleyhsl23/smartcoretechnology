// POST /api/presence-fire-safety/kiosk-switch-session { device_id }
// Lets an already-authenticated real person switch this browser's session
// to a registered kiosk device's dedicated login when entering Kiosk Mode —
// without ever needing to know that device's Basic Auth password (which is
// a separate, unrelated credential meant only for the kiosk browser's own
// unattended recovery, not for an admin manually switching accounts here).
//
// Uses the Supabase Admin API to generate a magic-link token for the
// device's account and immediately exchanges it server-side for a real
// session, which is handed back to the client to call sb.auth.setSession()
// with — the standard pattern for "admin mints a session for a known user
// without their password" (see functions/api/core/send-password-reset.js
// for the same generate_link call, used for the recovery-email case instead).
import { json, options, getCallerProfile, hasPermission, sb } from './_auth.js';

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorized' }, 401);

    const allowed = await hasPermission(env, profile.token, profile.company_id, 'presence.manage_settings');
    if (!allowed) return json({ error: 'Missing permission: presence.manage_settings' }, 403);

    const body = await request.json().catch(() => ({}));
    const deviceId = body.device_id;
    if (!deviceId) return json({ error: 'device_id is required' }, 400);

    const devRes = await sb(
      env,
      `/presence_fire_safety_devices?id=eq.${deviceId}&company_id=eq.${profile.company_id}&active=eq.true&basic_auth_enabled=eq.true&select=id,basic_auth_auth_user_id`
    );
    const [device] = await devRes.json();
    if (!device?.basic_auth_auth_user_id) return json({ error: 'No active kiosk account found for this device' }, 404);

    const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${device.basic_auth_auth_user_id}`, {
      headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
    });
    if (!userRes.ok) return json({ error: 'Could not look up the kiosk account' }, 500);
    const kioskUser = await userRes.json();
    if (!kioskUser?.email) return json({ error: 'Kiosk account has no email on file' }, 500);

    const linkRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'magiclink', email: kioskUser.email }),
    });
    const linkData = await linkRes.json();
    if (!linkRes.ok || !linkData.hashed_token) {
      return json({ error: linkData.message || linkData.error || 'Could not generate a kiosk session' }, 500);
    }

    const verifyRes = await fetch(`${env.SUPABASE_URL}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'magiclink', token_hash: linkData.hashed_token }),
    });
    const session = await verifyRes.json();
    if (!verifyRes.ok || !session.access_token || !session.refresh_token) {
      return json({ error: session.message || session.error || 'Could not establish the kiosk session' }, 500);
    }

    return json({ session: { access_token: session.access_token, refresh_token: session.refresh_token } });
  } catch (e) {
    return json({ error: e.message || 'Could not switch to the kiosk account' }, 500);
  }
}
