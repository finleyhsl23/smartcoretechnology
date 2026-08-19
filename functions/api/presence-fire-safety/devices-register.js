// POST /api/presence-fire-safety/devices-register
// Mints a new kiosk/handheld device credential. This MUST be a server-side
// endpoint: the raw device secret can never be exposed to normal
// RLS-governed client code (a device isn't an authenticated employee
// session), and only the SHA-256 hash of the secret is ever persisted.
// The raw secret is returned exactly once, in this response, and is never
// logged.
//
// If enable_basic_auth is set, this also gives the device Basic Auth
// recovery (see functions/api/kiosk-start.js) — but deliberately WITHOUT
// ever creating a real Supabase Auth user. A random UUID is stored directly
// as core_employees.auth_user_id (that column has no FK to auth.users) and
// kiosk-start.js/kiosk-switch-session.js sign a session JWT for it
// themselves (see _kiosk_jwt.js) — so a kiosk device never appears in
// Supabase Auth at all, only as a core_employees row scoped to this module.
// The Basic Auth username/password are this device's own credentials,
// hashed and checked directly against presence_fire_safety_devices — not a
// real login for anything else, and revocable independently of any person's
// actual account by deactivating the device.
import { json, options, getCallerProfile, hasPermission, sb } from './_auth.js';
import { sendResendEmail, smartcoreEmailShell } from '../_utils.js';
import { sha256Hex } from './_kiosk_jwt.js';

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
    let basicAuthUsername = null;
    let basicAuthPasswordHash = null;
    let basicAuthCredentials = null;
    if (enableBasicAuth) {
      // No Supabase Auth user is created here — just a random identity for
      // core_employees.auth_user_id (no FK to auth.users) that kiosk-start.js
      // signs a session JWT for directly. See _kiosk_jwt.js.
      basicAuthAuthUserId = crypto.randomUUID();

      const slug = deviceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'kiosk';
      basicAuthUsername = `kiosk-${slug}-${crypto.randomUUID().slice(0, 8)}`;
      const kioskPassword = generateDeviceSecret().slice(0, 32);
      basicAuthPasswordHash = await sha256Hex(kioskPassword);

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
        return json({ error: 'Could not allocate a unique kiosk employee ID — please try again' }, 500);
      }

      const empRes = await sb(env, '/core_employees', 'POST', {
        company_id: profile.company_id,
        auth_user_id: basicAuthAuthUserId,
        employee_id: kioskEmployeeId,
        full_name: `Kiosk: ${deviceName}`,
        // 'kiosk' — a dedicated role (not 'admin') so this account gets
        // full presence-fire-safety access (same as admin, within this one
        // module — see presence_fire_safety_my_permissions/has_permission)
        // but is never treated as a real admin/owner anywhere else on the
        // platform, and modules/index.html refuses to show it a normal
        // dashboard at all — a device isn't a person's account.
        role: 'kiosk',
      });
      if (!empRes.ok) {
        const errText = await empRes.text();
        throw new Error(errText || 'Could not create the kiosk employee record');
      }

      basicAuthCredentials = { username: basicAuthUsername, password: kioskPassword };
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
      basic_auth_username: basicAuthUsername,
      basic_auth_password_hash: basicAuthPasswordHash,
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      throw new Error(errText || 'Could not register device');
    }
    const [device] = await insertRes.json();

    // Best-effort — a new device is a security-relevant event (especially
    // with Basic Auth recovery enabled, which mints a standing sign-in
    // credential) that owners/admins should know about even if they weren't
    // the one who registered it. Never let this failing affect the
    // already-successful registration above.
    try {
      const adminsRes = await sb(env, `/core_employees?company_id=eq.${profile.company_id}&role=in.(owner,admin,administrator)&select=full_name,work_email`);
      const admins = (await adminsRes.json()).filter((a) => a.work_email);
      if (admins.length) {
        const html = smartcoreEmailShell({
          title: 'New device registered',
          intro: `${profile.full_name || 'Someone'} registered a new Presence &amp; Fire Safety device for <strong>${site.name}</strong>.`,
          bodyHtml: `
            <p><strong>Device:</strong> ${deviceName} (${deviceType})</p>
            <p><strong>Basic Auth recovery:</strong> ${enableBasicAuth ? 'Enabled' : 'Off'}</p>
            ${enableBasicAuth ? '<p style="color:#6b7280;font-size:13px">This device now has a standing sign-in credential for unattended kiosk recovery. If this wasn\'t expected, deactivate it in Settings → Devices.</p>' : ''}
          `,
          buttonText: 'View Devices',
          buttonUrl: 'https://smartcoretechnology.co.uk/systems/presence-fire-safety/settings.html',
        });
        await Promise.allSettled(
          admins.map((a) => sendResendEmail(env, { to: a.work_email, subject: `New device registered: ${deviceName}`, html }))
        );
      }
    } catch (e) {
      console.error('devices-register: admin notification failed', e.message);
    }

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
