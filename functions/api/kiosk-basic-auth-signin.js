// GET /api/kiosk-basic-auth-signin
// Optional, additive auto-recovery for unattended kiosk devices — NOT a
// login gate. Does nothing unless the request already carries an
// `Authorization: Basic` header, which we never challenge for ourselves; it
// only shows up when a device has been deliberately configured to send one
// (e.g. Fully Kiosk Browser's own "HTTP Authentication" setting, entered
// once in the kiosk app itself, sent automatically on every request from
// then on — independent of any web page's session/localStorage state).
// Every other visitor to /modules/ is completely unaffected: no header, no
// behaviour change, straight to the normal sign-in screen.
//
// If a Basic Auth header IS present, this treats it as the kiosk device's
// real SmartCore email + password (the same credentials used for the
// dashboard login), signs in via Supabase's password grant, and hands the
// resulting session back to the page so it can call sb.auth.setSession()
// and skip the login screen entirely — the intended use is a kiosk that
// lost its browser-stored session (e.g. after an overnight suspension) and
// has no one on-site to type the password back in.
const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function b64decode(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function onRequestGet({ request, env }) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return json({ error: 'No Basic Auth credentials on this request' }, 401);

  let email, password;
  try {
    const decoded = b64decode(header.slice(6));
    const idx = decoded.indexOf(':');
    if (idx < 0) throw new Error('malformed');
    email = decoded.slice(0, idx);
    password = decoded.slice(idx + 1);
  } catch {
    return json({ error: 'Malformed Basic Auth header' }, 400);
  }
  if (!email || !password) return json({ error: 'Missing email or password' }, 400);

  const baseUrl = env.SUPABASE_URL || SUPABASE_URL;
  const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) return json({ error: 'Invalid credentials' }, 401);
  const session = await res.json();
  return json({ session });
}
