// Shared Google OAuth helpers for Nova.
//
// Client secret and Supabase service key live in Cloudflare env vars and are
// never sent to the browser. The frontend only ever sees google_email, scopes
// and connected_at — never a token value.

export const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
export const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

export function redirectUri(request) {
  return new URL('/systems/nova/oauth-callback.html', new URL(request.url).origin).toString();
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// Verifies the caller's Supabase session and returns { userId, companyId, svcHdr }.
export async function authenticate(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: 'Unauthorised', status: 401 };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return { error: 'Unauthorised', status: 401 };
  const userData = await userRes.json();
  if (!userData?.id) return { error: 'Unauthorised', status: 401 };

  if (!env.SUPABASE_SERVICE_KEY) return { error: 'Server not configured', status: 500 };
  const svcHdr = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${userData.id}&select=company_id&limit=1`,
    { headers: svcHdr }
  );
  const prof = (await profRes.json().catch(() => []))?.[0];
  if (!prof?.company_id) return { error: 'Profile not found', status: 403 };

  return { userId: userData.id, companyId: prof.company_id, svcHdr };
}

// Reads the stored connection row for a user, or null if not connected.
export async function getConnection(userId, svcHdr) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/nova_google_tokens?user_id=eq.${userId}&select=*&limit=1`,
    { headers: svcHdr }
  );
  if (!res.ok) return null;
  return (await res.json().catch(() => []))?.[0] || null;
}

async function refreshAccessToken(conn, env, svcHdr) {
  if (!conn.refresh_token) return null;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: conn.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (!data.access_token) return null;

  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/nova_google_tokens?user_id=eq.${conn.user_id}`, {
    method: 'PATCH',
    headers: svcHdr,
    body: JSON.stringify({ access_token: data.access_token, expires_at: expiresAt, updated_at: new Date().toISOString() }),
  });

  return data.access_token;
}

// Returns a usable access token, refreshing it first if it is close to expiry.
// Returns null when the user has not connected Google or the refresh failed.
export async function getValidAccessToken(userId, svcHdr, env) {
  const conn = await getConnection(userId, svcHdr);
  if (!conn) return null;

  const expiresSoon = !conn.expires_at || (new Date(conn.expires_at).getTime() - Date.now() < 60_000);
  if (expiresSoon) return await refreshAccessToken(conn, env, svcHdr);
  return conn.access_token;
}

// Thin wrapper around a Google API call that surfaces a readable error string.
export async function googleApi(accessToken, url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = text; }
  if (!res.ok) {
    const msg = data?.error?.message || (typeof data === 'string' ? data : JSON.stringify(data));
    return { ok: false, error: msg, status: res.status };
  }
  return { ok: true, data };
}
