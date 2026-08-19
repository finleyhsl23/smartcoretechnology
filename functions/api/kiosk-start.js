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

  let email, password;
  try {
    const decoded = b64decode(header.slice(6));
    const idx = decoded.indexOf(':');
    if (idx < 0) throw new Error('malformed');
    email = decoded.slice(0, idx);
    password = decoded.slice(idx + 1);
  } catch {
    return errorPage('Malformed credentials.');
  }
  if (!email || !password) return errorPage('Missing email or password.');

  const baseUrl = env.SUPABASE_URL || SUPABASE_URL;
  const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) return errorPage('The configured username/password were rejected.');
  const session = await res.json();
  if (!session?.access_token || !session?.refresh_token || !session?.user?.id) return errorPage('Sign-in did not return a usable session.');

  // The password grant above only proves these are valid Supabase
  // credentials — it says nothing about whether the device they belong to
  // is still meant to have kiosk recovery access. Deactivating a device in
  // Settings → Devices must actually revoke this, not just look like it
  // does, so check the device row itself before granting entry.
  const deviceRes = await fetch(
    `${baseUrl}/rest/v1/presence_fire_safety_devices?basic_auth_auth_user_id=eq.${session.user.id}&basic_auth_enabled=eq.true&active=eq.true&select=id&limit=1`,
    { headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` } }
  );
  const devices = await deviceRes.json().catch(() => []);
  if (!deviceRes.ok || !devices?.length) return errorPage('This device has been deactivated.');

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Signing in…</title>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#03060f;color:#e2e8f0">
  <div>Signing in…</div>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    const sb = supabase.createClient(${JSON.stringify(baseUrl)}, ${JSON.stringify(SUPABASE_ANON)});
    sb.auth.setSession({
      access_token: ${JSON.stringify(session.access_token)},
      refresh_token: ${JSON.stringify(session.refresh_token)},
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
