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

  // Deliberately does NOT use supabase-js's own auth.setSession() here.
  // setSession() calls Supabase Auth's /auth/v1/user endpoint to hydrate the
  // full user object, and that endpoint rejects any JWT whose `sub` isn't a
  // real row in auth.users — exactly what a kiosk identity is not by design
  // (see functions/api/presence-fire-safety/_kiosk_jwt.js). Instead, this
  // writes the session directly into the same localStorage key supabase-js
  // uses by default (`sb-<project-ref>-auth-token`) and does a plain
  // navigation — the destination page's own fresh client picks the session
  // up from storage on init without ever calling that endpoint, as long as
  // it isn't already near expiry (a freshly-minted 7-day token never is).
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Signing in…</title>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#03060f;color:#e2e8f0">
  <div>Signing in…</div>
  <script>
    (function () {
      function decodeJwtPayload(jwt) {
        var b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        var pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
        return JSON.parse(atob(b64 + pad));
      }
      var accessToken = ${JSON.stringify(jwt)};
      var payload = decodeJwtPayload(accessToken);
      var iat = payload.iat || Math.floor(Date.now() / 1000);
      var nowIso = new Date(iat * 1000).toISOString();
      var session = {
        access_token: accessToken,
        refresh_token: 'kiosk-self-signed-no-refresh',
        token_type: 'bearer',
        expires_in: payload.exp - iat,
        expires_at: payload.exp,
        user: {
          id: payload.sub,
          aud: payload.aud || 'authenticated',
          role: payload.role || 'authenticated',
          email: '',
          phone: '',
          app_metadata: {},
          user_metadata: {},
          identities: [],
          created_at: nowIso,
          updated_at: nowIso,
        },
      };
      localStorage.setItem('sb-hjdpcfhozhoyeqevnupm-auth-token', JSON.stringify(session));
      localStorage.setItem('smartcore-pfs-kiosk-mode', '1');
      window.location.replace(${JSON.stringify(next)});
    })();
  </script>
</body>`;

  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
}
