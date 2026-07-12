// POST /api/presence-fire-safety/kiosk-checkin
// Called by a kiosk/handheld device on startup (or periodically) with the
// raw device token it was issued at registration time. This endpoint hashes
// the submitted token and compares it to the stored device_token_hash —
// a bare device id from the browser/localStorage is never treated as proof
// of authorisation on its own. On success it returns only the device's
// site/company context so the kiosk UI knows where it is; it does NOT
// authenticate an employee. Recording an actual presence event still
// requires a normal authenticated employee session calling the
// presence_fire_safety_record_presence_event RPC directly (see
// systems/presence-fire-safety/shared/api.js) — a device token alone can
// never authorise that.
import { json, options, sb } from './_auth.js';

export const onRequestOptions = () => options();

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const deviceToken = body.device_token;
    if (!deviceToken || typeof deviceToken !== 'string') {
      return json({ error: 'device_token is required' }, 400);
    }

    const tokenHash = await sha256Hex(deviceToken);

    const devRes = await sb(
      env,
      `/presence_fire_safety_devices?device_token_hash=eq.${tokenHash}&active=eq.true&select=id,company_id,site_id,device_name,device_type`
    );
    const [device] = await devRes.json();
    // Never reveal whether the token was malformed vs. simply not found —
    // both are just "invalid device token" to the caller.
    if (!device) return json({ error: 'Invalid or inactive device token' }, 401);

    const modRes = await sb(
      env,
      `/company_modules?company_id=eq.${device.company_id}&module_key=eq.presence-and-fire-safety&select=enabled&limit=1`
    );
    const [mod] = await modRes.json();
    if (!mod?.enabled) return json({ error: 'Presence & Fire Safety is not enabled for this company' }, 403);

    // Best-effort last_seen_at bump — never block/fail the check-in on this.
    sb(env, `/presence_fire_safety_devices?id=eq.${device.id}`, 'PATCH', {
      last_seen_at: new Date().toISOString(),
    }).catch(() => {});

    return json({
      device_id: device.id,
      company_id: device.company_id,
      site_id: device.site_id,
      device_name: device.device_name,
      device_type: device.device_type,
    });
  } catch (e) {
    return json({ error: e.message || 'Kiosk check-in failed' }, 500);
  }
}
