export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...extraHeaders
    }
  });
}

export function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

export function requireEnv(env, name) {
  const value = env?.[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function getAppBaseUrl(env) {
  return env.PUBLIC_APP_URL || env.APP_URL || 'https://smartcoretechnology.co.uk';
}

export function getEmailFrom(env) {
  return (
    env.RESEND_FROM ||
    env.RESEND_FROM_EMAIL ||
    env.EMAIL_FROM ||
    'SmartCore Technology <noreply@smartcoretechnology.co.uk>'
  );
}

export async function supabaseRequest(env, path, options = {}) {
  const SUPABASE_URL = requireEnv(env, 'SUPABASE_URL').replace(/\/$/, '');
  const SERVICE_ROLE = requireEnv(env, 'SUPABASE_SERVICE_ROLE');

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  if (!response.ok) {
    const message = body?.message || body?.error || text || 'Supabase request failed';
    const error = new Error(message);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

export async function supabaseRpc(env, fnName, payload = {}) {
  return supabaseRequest(env, `rpc/${fnName}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function sendResendEmail(env, { to, subject, html }) {
  const RESEND_API_KEY = requireEnv(env, 'RESEND_API_KEY');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: getEmailFrom(env),
      to,
      subject,
      html
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result?.message || 'Resend email failed');
    error.details = result;
    error.status = response.status;
    throw error;
  }

  return result;
}

export function smartcoreEmailShell({ title, intro, buttonText, buttonUrl, bodyHtml = '' }) {
  return `
    <div style="font-family:Arial,sans-serif;background:#f6f8fb;padding:24px;color:#111827;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e5e7eb;">
        <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;">${title}</h1>
        <p style="font-size:15px;line-height:1.6;">${intro}</p>
        ${bodyHtml}
        ${buttonUrl ? `
          <p style="margin:28px 0;">
            <a href="${buttonUrl}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:bold;display:inline-block;">
              ${buttonText || 'Open'}
            </a>
          </p>
          <p style="font-size:13px;color:#6b7280;">If the button does not work, copy this link into your browser:</p>
          <p style="word-break:break-all;color:#2563eb;font-size:13px;">${buttonUrl}</p>
        ` : ''}
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
        <p style="font-size:13px;color:#6b7280;margin:0;">
          Powered by SmartCore Technology<br />
          Practical Technology. Built to Last.
        </p>
      </div>
    </div>
  `;
}
