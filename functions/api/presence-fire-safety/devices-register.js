// POST /api/presence-fire-safety/devices-register
// Mints a new kiosk/handheld device credential. This MUST be a server-side
// endpoint: the raw device secret can never be exposed to normal
// RLS-governed client code (a device isn't an authenticated employee
// session), and only the SHA-256 hash of the secret is ever persisted.
// The raw secret is returned exactly once, in this response, and is never
// logged.
import { json, options, getCallerProfile, hasPermission, sb } from './_auth.js';

export const onRequestOptions = () => options();

const DEVICE_TYPES = ['kiosk', 'handheld', 'desktop', 'other'];

function generateDeviceSecret() {
  // 32 bytes of CSPRNG entropy plus a UUID for good measure — this value is
  // shown to the admin exactly once and then discarded server-side.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const extra = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(/-/g, '');
  return `${hex}${extra}`;
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorized' }, 401);

    const allowed = await hasPermission(env, profile.token, profile.company_id, 'presence.manage_settings');
    if (!allowed) return json({ error: 'Missing permission: presence.manage_settings' }, 403);

    const body = await request.json().catch(() => ({}));
    const siteId = body.site_id;
    const deviceName = String(body.device_name || '').trim();
    const deviceType = DEVICE_TYPES.includes(body.device_type) ? body.device_type : 'kiosk';

    if (!siteId) return json({ error: 'site_id is required' }, 400);
    if (!deviceName) return json({ error: 'device_name is required' }, 400);

    // Confirm the site actually belongs to the caller's company before
    // minting a credential scoped to it.
    const siteRes = await sb(env, `/sites?id=eq.${siteId}&company_id=eq.${profile.company_id}&select=id,name&limit=1`);
    const [site] = await siteRes.json();
    if (!site) return json({ error: 'Site not found' }, 404);

    const rawSecret = generateDeviceSecret();
    const tokenHash = await sha256Hex(rawSecret);

    const insertRes = await sb(env, '/presence_fire_safety_devices', 'POST', {
      company_id: profile.company_id,
      site_id: siteId,
      device_name: deviceName,
      device_type: deviceType,
      device_token_hash: tokenHash,
      active: true,
      created_by: profile.id,
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      throw new Error(errText || 'Could not register device');
    }
    const [device] = await insertRes.json();

    // Never log rawSecret or tokenHash.
    return json({
      device: {
        id: device.id,
        site_id: device.site_id,
        site_name: site.name,
        device_name: device.device_name,
        device_type: device.device_type,
        active: device.active,
        created_at: device.created_at,
      },
      device_token: rawSecret,
      warning: 'Store this token now — it will not be shown again.',
    });
  } catch (e) {
    return json({ error: e.message || 'Could not register device' }, 500);
  }
}
