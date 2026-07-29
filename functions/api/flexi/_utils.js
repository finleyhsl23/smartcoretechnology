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
  return client;
}

export function welcomeEmailHtml({ businessName, primaryColor, fullName, trainerCode, email, passcode, portalUrl }) {
  const color = primaryColor || '#ff5a36';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f5fb;font-family:'Segoe UI',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5fb;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:560px;width:100%">
        <tr>
          <td style="background:linear-gradient(135deg,#ff7a45,${color},#ff3d7f);padding:28px 36px;text-align:center">
            <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">${businessName}</div>
            <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:6px">Powered by Flexi</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 24px">
            <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0a0f2e">Welcome, ${fullName}! 💪</h2>
            <p style="margin:0 0 24px;font-size:15px;color:#4b5563;line-height:1.6">${businessName} has set you up on Flexi — your programs, bookings, nutrition and progress tracking, all in one app.</p>
            <div style="background:#f8f9fc;border-radius:12px;padding:20px 24px;margin-bottom:24px;border:1px solid #e5e7eb">
              <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;margin-bottom:14px">Your login details</div>
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr><td style="font-size:13px;color:#6b7280;padding:5px 0;width:110px">Trainer code</td><td style="font-size:16px;font-weight:800;letter-spacing:2px;color:${color};padding:5px 0">${trainerCode}</td></tr>
                <tr><td style="font-size:13px;color:#6b7280;padding:5px 0">Email</td><td style="font-size:14px;font-weight:600;color:#1a1a2e;padding:5px 0">${email}</td></tr>
                <tr><td style="font-size:13px;color:#6b7280;padding:5px 0">Passcode</td><td style="font-size:16px;font-weight:800;letter-spacing:2px;color:#1a1a2e;padding:5px 0">${passcode}</td></tr>
              </table>
            </div>
            <table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
              <a href="${portalUrl}" style="display:inline-block;background:${color};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:99px;letter-spacing:.2px">Open Flexi →</a>
            </td></tr></table>
            <p style="margin:10px 0 0;font-size:12px;color:#9ca3af;text-align:center">Or paste this link into your browser:<br/><span style="color:#6b7280">${portalUrl}</span></p>
            <p style="margin:20px 0 0;font-size:13px;color:#9ca3af;text-align:center">Keep your passcode private — it's how you sign in.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f9fc;border-top:1px solid #e5e7eb;padding:18px 36px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af">${businessName} · Powered by <a href="https://smartcoretechnology.co.uk" style="color:${color};text-decoration:none">SmartCore Flexi</a></p>
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
