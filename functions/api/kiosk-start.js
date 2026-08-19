// GET /api/kiosk-start?next=/systems/presence-fire-safety/employee-signin.html
// Dedicated kiosk entry point — meant to be configured as the device's own
// browser Start URL (e.g. Fully Kiosk Browser's "Start URL" setting), NOT
// linked from anywhere in the normal site. That's what makes it safe to
// issue a real HTTP Basic Auth challenge here: this URL only exists in a
// kiosk device's own configuration, so no ordinary customer's browser will
// ever navigate to it and get surprised by a native login popup — unlike
// challenging on a shared page like /modules/, which every customer's
// browser might hit in the background.
//
// Android's WebView (what Fully Kiosk Browser is built on) auto-fills its
// configured Basic Auth username/password in response to a real 401 +
// WWW-Authenticate challenge on a top-level navigation — that's the native
// hook (onReceivedHttpAuthRequest) this relies on. This is the mechanism
// that lets an unattended kiosk recover its own session (e.g. after an
// overnight suspension wiped it) with nobody on-site to type a password.
//
// The username/password checked here are the device's OWN credentials
// (hashed, stored on presence_fire_safety_devices) — not a real Supabase
// Auth login. See functions/api/presence-fire-safety/devices-register.js
// and _kiosk_jwt.js for why: a kiosk device deliberately never creates a
// real auth.users row at all, only a core_employees row scoped to this one
// module, with a JWT this endpoint signs itself.
import { signKioskJwt, sha256Hex } from './presence-fire-safety/_kiosk_jwt.js';

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';
const DEFAULT_NEXT = '/systems/presence-fire-safety/employee-signin.html';

function challenge(message) {
  return new Response(message, {
    status: 401,
    headers: { 'Content-Type': 'text/plain', 'WWW-Authenticate': 'Basic realm="SmartCore Kiosk"' },
  });
}

function errorPage(message) {
  // No WWW-Authenticate here on purpose — re-challenging on bad credentials
  // would make a WebView with wrong stored creds retry forever in a silent
  // loop instead of surfacing anything an admin could notice and fix.
  return new Response(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;text-align:center;color:#b91c1c">
    <h2>Kiosk sign-in failed</h2><p>${message}</p>
    <p style="color:#666;font-size:14px">Check the username/password configured in this device's browser settings.</p>
  </body>`, { status: 401, headers: { 'Content-Type': 'text/html' } });
}

function b64decode(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const next = url.searchParams.get('next') || DEFAULT_NEXT;

  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return challenge('Sign-in required');

  let username, password;
  try {
    const decoded = b64decode(header.slice(6));
    const idx = decoded.indexOf(':');
    if (idx < 0) throw new Error('malformed');
    username = decoded.slice(0, idx);
    password = decoded.slice(idx + 1);
  } catch {
    return errorPage('Malformed credentials.');
  }
  if (!username || !password) return errorPage('Missing username or password.');

  const baseUrl = env.SUPABASE_URL || SUPABASE_URL;
  const deviceRes = await fetch(
    `${baseUrl}/rest/v1/presence_fire_safety_devices?basic_auth_username=eq.${encodeURIComponent(username)}&basic_auth_enabled=eq.true&active=eq.true&select=id,basic_auth_auth_user_id,basic_auth_password_hash&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  const devices = await deviceRes.json().catch(() => []);
  const device = devices?.[0];
  if (!deviceRes.ok || !device) return errorPage('The configured username/password were rejected.');

  const passwordHash = await sha256Hex(password);
  if (passwordHash !== device.basic_auth_password_hash) return errorPage('The configured username/password were rejected.');

  const jwt = await signKioskJwt(env, device.basic_auth_auth_user_id);

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Signing in…</title>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#03060f;color:#e2e8f0">
  <div>Signing in…</div>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    const sb = supabase.createClient(${JSON.stringify(baseUrl)}, ${JSON.stringify(SUPABASE_ANON)});
    // No real refresh token exists for a self-signed kiosk session — this
    // token is long-lived (7 days) instead, and this same recovery flow
    // re-mints a fresh one well before that (Fully Kiosk Browser reloads
    // this Start URL periodically/on reboot) rather than needing one.
    sb.auth.setSession({
      access_token: ${JSON.stringify(jwt)},
      refresh_token: "kiosk-self-signed-no-refresh",
    }).then(({ error }) => {
      if (error) {
        document.body.textContent = 'Could not establish session: ' + error.message;
        return;
      }
      localStorage.setItem('smartcore-pfs-kiosk-mode', '1');
      window.location.replace(${JSON.stringify(next)});
    });
  </script>
</body>`;

  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
}
