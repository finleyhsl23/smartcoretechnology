// POST /api/presence-fire-safety/kiosk-switch-session { device_id }
// Lets an already-authenticated real person switch this browser's session
// to a registered kiosk device's dedicated login when entering Kiosk Mode —
// without ever needing to know that device's Basic Auth password (which is
// a separate, unrelated credential meant only for the kiosk browser's own
// unattended recovery, not for an admin manually switching accounts here).
//
// Kiosk device identities have no real Supabase Auth user behind them at
// all (see devices-register.js/_kiosk_jwt.js) — this just signs a session
// JWT directly for the device's stored auth_user_id, same as kiosk-start.js
// does for the Basic Auth recovery case.
import { json, options, getCallerProfile, hasPermission, sb } from './_auth.js';
import { signKioskJwt } from './_kiosk_jwt.js';

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

    const jwt = await signKioskJwt(env, device.basic_auth_auth_user_id);
    // No real refresh token — see kiosk-start.js for why; the client falls
    // back to re-fetching a fresh switch/kiosk-start session rather than
    // relying on Supabase's own refresh flow for this identity.
    return json({ session: { access_token: jwt, refresh_token: 'kiosk-self-signed-no-refresh' } });
  } catch (e) {
    return json({ error: e.message || 'Could not switch to the kiosk account' }, 500);
  }
}
