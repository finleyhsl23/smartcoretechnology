// POST /api/presence-fire-safety/devices-register
// Mints a new kiosk/handheld device credential. This MUST be a server-side
// endpoint: the raw device secret can never be exposed to normal
// RLS-governed client code (a device isn't an authenticated employee
// session), and only the SHA-256 hash of the secret is ever persisted.
// The raw secret is returned exactly once, in this response, and is never
// logged.
//
// If enable_basic_auth is set, ALSO provisions a dedicated Supabase login
// used only for kiosk Basic Auth recovery (see functions/api/kiosk-start.js)
// — deliberately never a real employee's own password, so a kiosk browser's
// stored credentials are worthless for anything beyond signing into that
// one low-privilege device identity, and can be revoked independently by
// deactivating the device.
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
    const enableBasicAuth = !!body.enable_basic_auth;

    if (!siteId) return json({ error: 'site_id is required' }, 400);
    if (!deviceName) return json({ error: 'device_name is required' }, 400);

    // Confirm the site actually belongs to the caller's company before
    // minting a credential scoped to it.
    const siteRes = await sb(env, `/sites?id=eq.${siteId}&company_id=eq.${profile.company_id}&select=id,name&limit=1`);
    const [site] = await siteRes.json();
    if (!site) return json({ error: 'Site not found' }, 404);

    const rawSecret = generateDeviceSecret();
    const tokenHash = await sha256Hex(rawSecret);

    let basicAuthAuthUserId = null;
    let basicAuthCredentials = null;
    if (enableBasicAuth) {
      const slug = deviceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'kiosk';
      const kioskEmail = `kiosk-${slug}-${crypto.randomUUID().slice(0, 8)}@devices.smartcoretechnology.internal`;
      const kioskPassword = generateDeviceSecret().slice(0, 32);

      const authRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: kioskEmail,
          password: kioskPassword,
          email_confirm: true,
          user_metadata: { is_kiosk_device: true, device_name: deviceName },
        }),
      });
      if (!authRes.ok) {
        const err = await authRes.json().catch(() => ({}));
        return json({ error: err.message || 'Could not create the kiosk sign-in account' }, 500);
      }
      const authUser = await authRes.json();
      basicAuthAuthUserId = authUser.id;

      // core_employees.employee_id is required and unique company-wide —
      // same generation scheme as the normal "add employee" flow (see
      // functions/api/core/add-employee.js), just with a fixed KSK prefix
      // so these are obviously device accounts, not real headcount, at a
      // glance in any employee list.
      let kioskEmployeeId;
      for (let attempt = 0; attempt < 5; attempt++) {
        const digits = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
        const candidate = `KSK${digits}`;
        const existing = await sb(env, `/core_employees?employee_id=eq.${candidate}&select=id&limit=1`);
        const existingRows = await existing.json();
        if (!existingRows?.length) { kioskEmployeeId = candidate; break; }
      }
      if (!kioskEmployeeId) {
        await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${authUser.id}`, {
          method: 'DELETE',
          headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
        }).catch(() => {});
        return json({ error: 'Could not allocate a unique kiosk employee ID — please try again' }, 500);
      }

      const empRes = await sb(env, '/core_employees', 'POST', {
        company_id: profile.company_id,
        auth_user_id: authUser.id,
        employee_id: kioskEmployeeId,
        full_name: `Kiosk: ${deviceName}`,
        role: 'employee',
        work_email: kioskEmail,
      });
      if (!empRes.ok) {
        // Best-effort cleanup — don't leave an orphaned auth user behind if
        // the employee record failed to create.
        await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${authUser.id}`, {
          method: 'DELETE',
          headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` },
        }).catch(() => {});
        const errText = await empRes.text();
        throw new Error(errText || 'Could not create the kiosk employee record');
      }

      basicAuthCredentials = { username: kioskEmail, password: kioskPassword };
    }

    const insertRes = await sb(env, '/presence_fire_safety_devices', 'POST', {
      company_id: profile.company_id,
      site_id: siteId,
      device_name: deviceName,
      device_type: deviceType,
      device_token_hash: tokenHash,
      active: true,
      created_by: profile.id,
      basic_auth_enabled: enableBasicAuth,
      basic_auth_auth_user_id: basicAuthAuthUserId,
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      throw new Error(errText || 'Could not register device');
    }
    const [device] = await insertRes.json();

    // Never log rawSecret, tokenHash, or basicAuthCredentials.
    return json({
      device: {
        id: device.id,
        site_id: device.site_id,
        site_name: site.name,
        device_name: device.device_name,
        device_type: device.device_type,
        active: device.active,
        created_at: device.created_at,
        basic_auth_enabled: device.basic_auth_enabled,
      },
      device_token: rawSecret,
      basic_auth: basicAuthCredentials,
      warning: 'Store these now — they will not be shown again.',
    });
  } catch (e) {
    return json({ error: e.message || 'Could not register device' }, 500);
  }
}
