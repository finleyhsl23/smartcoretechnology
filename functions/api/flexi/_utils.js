// Shared helpers for Flexi's Cloudflare Pages Functions.
// Mirrors the pattern already proven by functions/api/crm/portal-*.js: no
// Supabase Auth session for clients at all — the service-role key does every
// database call, and access is scoped in JS using an opaque session token
// (for clients) or a verified trainer Supabase Auth token (for staff).

export const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

// Passcodes and trainer codes both draw from this charset — no 0/O/1/I/L so
// a code read aloud or handwritten can't be misheard/misread.
const CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function genCode(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => CODE_CHARSET[b % CODE_CHARSET.length]).join('');
}

export async function hashCode(code, email) {
  const enc = new TextEncoder();
  const data = enc.encode(String(code).toUpperCase() + ':' + String(email).toLowerCase());
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function svc(env) {
  const key = env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

export async function sb(env, path, { method = 'GET', body, extraHeaders } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      ...svc(env),
      'Content-Type': 'application/json',
      Prefer: method === 'GET' ? undefined : 'return=representation',
      ...(extraHeaders || {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${path} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Verifies a trainer/staff Supabase Auth bearer token and resolves their
// core_employees row — the same identity every other module uses. Returns
// null (never throws) so callers can respond 401 uniformly.
export async function getTrainerProfile(request, env) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_KEY },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  const rows = await sb(env, `/core_employees?auth_user_id=eq.${user.id}&select=id,company_id,role,full_name&limit=1`);
  return rows?.[0] || null;
}

// Verifies a client's opaque session token. Returns null (never throws) if
// missing, unknown, or expired.
export async function verifyClientSession(request, env) {
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const rows = await sb(env, `/smartcore_flexi_clients?session_token=eq.${encodeURIComponent(token)}&select=*&limit=1`);
  const client = rows?.[0];
  if (!client) return null;
  if (client.session_expires_at && new Date(client.session_expires_at) < new Date()) return null;

  // Sliding expiry — an actively-used session should never quietly run out
  // from under someone. Only bother extending it once it's within 30 days
  // of expiring, so this isn't a write on every single request.
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const expiresAtMs = client.session_expires_at ? new Date(client.session_expires_at).getTime() : 0;
  if (expiresAtMs - Date.now() < THIRTY_DAYS_MS) {
    const newExpiry = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    sb(env, `/smartcore_flexi_clients?id=eq.${client.id}`, {
      method: 'PATCH', body: { session_expires_at: newExpiry }, extraHeaders: { Prefer: 'return=minimal' },
    }).catch(() => {});
  }
  return client;
}

export function welcomeEmailHtml({ businessName, primaryColor, fullName, trainerCode, email, passcode, portalUrl }) {
  const color = primaryColor || '#ff5a36';
  const grad = `linear-gradient(128deg, #ff7a45 0%, ${color} 45%, #ff3d7f 100%)`;
  const font = `-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',Roboto,Arial,sans-serif`;
  const feature = (emoji, label) => `
    <td align="center" style="padding:0 6px">
      <table cellpadding="0" cellspacing="0"><tr><td align="center" style="width:52px;height:52px;border-radius:14px;background:#f6f7fc;border:1px solid #ecedf6;font-size:20px;line-height:52px">${emoji}</td></tr></table>
      <div style="font-size:11px;font-weight:700;color:#6b6f8f;margin-top:8px">${label}</div>
    </td>`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#eaecf6;font-family:${font}">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#eaecf6;padding:40px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 20px 48px rgba(23,25,50,.14);max-width:560px;width:100%">
        <tr>
          <td style="background:${grad};padding:40px 36px 32px;text-align:center">
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 18px"><tr><td style="width:46px;height:46px;border-radius:13px;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.35);font-size:20px;font-weight:800;color:#ffffff;text-align:center;line-height:46px">F</td></tr></table>
            <div style="font-size:23px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">${businessName}</div>
            <div style="color:rgba(255,255,255,0.85);font-size:12.5px;margin-top:6px;font-weight:600;letter-spacing:.3px">POWERED BY FLEXI</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 8px">
            <h2 style="margin:0 0 8px;font-size:23px;font-weight:800;color:#13141f;letter-spacing:-.02em">Welcome, ${fullName}! 💪</h2>
            <p style="margin:0 0 26px;font-size:14.5px;color:#4a4d68;line-height:1.65">${businessName} has set you up on Flexi — your programs, bookings, nutrition and progress tracking, all in one place.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 26px 28px">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              ${feature('🏋️', 'Train')}
              ${feature('📅', 'Book')}
              ${feature('🥗', 'Nutrition')}
              ${feature('📈', 'Progress')}
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 36px">
            <div style="background:#f8f9fc;border-radius:16px;padding:22px 24px;margin-bottom:26px;border:1px solid #ecedf6">
              <div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#888ba6;margin-bottom:14px">Your login details</div>
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr><td style="font-size:13px;color:#6b6f8f;padding:6px 0;width:112px">Trainer code</td><td style="font-size:17px;font-weight:800;letter-spacing:2.5px;color:${color};padding:6px 0">${trainerCode}</td></tr>
                <tr><td style="font-size:13px;color:#6b6f8f;padding:6px 0;border-top:1px solid #ecedf6">Email</td><td style="font-size:14px;font-weight:600;color:#13141f;padding:6px 0;border-top:1px solid #ecedf6">${email}</td></tr>
                <tr><td style="font-size:13px;color:#6b6f8f;padding:6px 0;border-top:1px solid #ecedf6">Passcode</td><td style="font-size:17px;font-weight:800;letter-spacing:2.5px;color:#13141f;padding:6px 0;border-top:1px solid #ecedf6">${passcode}</td></tr>
              </table>
            </div>
            <table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
              <a href="${portalUrl}" style="display:inline-block;background:${grad};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:15px 40px;border-radius:99px;letter-spacing:.2px;box-shadow:0 8px 24px rgba(255,90,54,.32)">Open Flexi →</a>
            </td></tr></table>
            <p style="margin:14px 0 0;font-size:12px;color:#9698b3;text-align:center">Or paste this link into your browser:<br/><span style="color:#6b6f8f">${portalUrl}</span></p>
            <p style="margin:22px 0 32px;font-size:12.5px;color:#9698b3;text-align:center">Keep your passcode private — it's how you sign in.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f9fc;border-top:1px solid #ecedf6;padding:20px 36px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9698b3">${businessName} · Powered by <a href="https://smartcoretechnology.co.uk" style="color:${color};text-decoration:none;font-weight:600">SmartCore Flexi</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Fetches the company's trainer_code, generating a unique one on first use.
// Service-role only — bypasses the flexi_ensure_trainer_code() RPC (which
// checks auth.uid() against core_employees and so only works when called
// with the trainer's own Supabase session, e.g. from settings.html).
export async function ensureTrainerCode(env, companyId) {
  const rows = await sb(env, `/smartcore_flexi_settings?company_id=eq.${companyId}&select=trainer_code`);
  const existing = rows?.[0]?.trainer_code;
  if (existing) return existing;

  let code;
  for (let attempt = 0; attempt < 8; attempt++) {
    code = genCode(6);
    const clash = await sb(env, `/smartcore_flexi_settings?trainer_code=eq.${code}&select=company_id`);
    if (!clash?.length) break;
  }
  await sb(env, `/smartcore_flexi_settings`, {
    method: 'POST',
    body: { company_id: companyId, trainer_code: code },
    extraHeaders: { Prefer: 'resolution=merge-duplicates,return=representation' },
  });
  return code;
}

// Uploads a base64-encoded file to the private flexi-media bucket and
// returns a long-lived signed URL. Runs with the service key since there's
// no client Storage session to satisfy the bucket's RLS policies.
export async function uploadToStorage(env, path, base64Data, contentType) {
  const binary = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
  const upRes = await fetch(`${SUPABASE_URL}/storage/v1/object/flexi-media/${path}`, {
    method: 'POST',
    headers: { ...svc(env), 'Content-Type': contentType || 'image/jpeg', 'x-upsert': 'true' },
    body: binary,
  });
  if (!upRes.ok) throw new Error(`Storage upload failed: ${await upRes.text()}`);

  const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/flexi-media/${path}`, {
    method: 'POST',
    headers: { ...svc(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 365 }),
  });
  const signJson = await signRes.json();
  return signJson?.signedURL ? `${SUPABASE_URL}/storage/v1${signJson.signedURL}` : null;
}

export async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'RESEND_API_KEY not configured' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM || 'SmartCore Flexi <noreply@smartcoretechnology.co.uk>', to: [to], subject, html }),
  });
  if (!res.ok) return { sent: false, reason: await res.text() };
  return { sent: true };
}
