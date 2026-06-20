/**
 * POST /api/send-verify-email
 * Creates/replaces a pending signup, generates 6-digit code, sends branded HTML email.
 * Body: { email: string, password: string }
 */

const SUPABASE_URL      = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';
const FROM              = 'SmartCore <noreply@smartcoretechnology.co.uk>';
const SITE              = 'https://smartcoretechnology.co.uk';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const resendKey = env.RESEND_SMARTCORE_SHOP;
    if (!resendKey) return json({ error: 'Email service not configured' }, 500);

    const { email, password } = await request.json();
    if (!email || !password) return json({ error: 'email and password required' }, 400);
    if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);

    // Check if email already has an account
    const existsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/check_email_registered`,
      {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ check_email: email }),
      }
    );
    if (existsRes.ok) {
      const alreadyExists = await existsRes.json();
      if (alreadyExists === true) {
        return json({ error: 'An account with this email already exists. Please sign in instead.' }, 409);
      }
    }

    // Hash the password with SHA-256 so we don't store plaintext
    const pwHash = await sha256(password);

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // Invalidate any previous unused codes for this email, then insert new one
    await supabaseRpc(env, 'verification_codes', 'email=eq.' + encodeURIComponent(email), 'DELETE');
    await supabaseFetch(
      `${SUPABASE_URL}/rest/v1/verification_codes`,
      'POST',
      { email, code, password_hash: pwHash }
    );

    // Send branded email
    await sendEmail(resendKey, email, 'Your SmartCore verification code', verifyHtml(email, code));

    return json({ success: true }, 200);
  } catch (err) {
    console.error('send-verify-email error:', err);
    return json({ error: err.message || 'Internal error' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function supabaseFetch(url, method, body) {
  const r = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { const t = await r.text(); throw new Error(t); }
  return r;
}

async function supabaseRpc(env, table, filter, method) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json',
    },
  });
}

async function sendEmail(key, to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!r.ok) { const t = await r.text(); throw new Error(t); }
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------------------------------------------------------------------------
// Email template
// ---------------------------------------------------------------------------
function verifyHtml(email, code) {
  const digits = code.split('').map(d =>
    `<span style="display:inline-block;width:52px;height:64px;line-height:64px;text-align:center;font-size:32px;font-weight:900;color:#5b8fff;background:rgba(91,143,255,.1);border:2px solid rgba(91,143,255,.25);border-radius:14px;margin:0 4px;font-family:ui-monospace,'Courier New',monospace">${d}</span>`
  ).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartCore Verification</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#06060e;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#e0e0ea;-webkit-font-smoothing:antialiased}
.wrap{max-width:600px;margin:32px auto;border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.08);box-shadow:0 32px 80px rgba(0,0,0,.7)}
.hdr{background:linear-gradient(135deg,#0b0b18 0%,#0f1529 60%,#0c1220 100%);padding:32px 40px;border-bottom:1px solid rgba(255,255,255,.07)}
.logo{display:inline-flex;align-items:center;gap:12px;text-decoration:none}
.logo-mark{width:42px;height:42px;border-radius:12px;overflow:hidden;display:block}
.logo-name{font-size:17px;font-weight:800;color:#f5f5f7;letter-spacing:-.03em}
.logo-tag{font-size:10px;color:rgba(255,255,255,.35);letter-spacing:.08em;text-transform:uppercase;margin-top:1px}
.body{background:#0e0e18;padding:48px 40px;text-align:center}
.tag{display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:rgba(91,143,255,.15);color:#5b8fff;border:1px solid rgba(91,143,255,.25);margin-bottom:24px}
h1{font-size:28px;font-weight:800;color:#f5f5f7;letter-spacing:-.04em;line-height:1.2;margin-bottom:10px}
.intro{font-size:15px;color:#8a8a9e;line-height:1.75;margin-bottom:36px}
.code-row{display:flex;justify-content:center;align-items:center;margin:0 0 12px}
.code-plain{font-size:13px;color:#52526e;letter-spacing:.06em;margin-bottom:36px}
.notice{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:20px 24px;text-align:left;margin:0 0 24px}
.notice p{font-size:13px;color:#7a7a96;line-height:1.75}
.notice strong{color:#a0a0b4}
.divider{height:1px;background:rgba(255,255,255,.06);margin:24px 0}
.small{font-size:13px;color:#7a7a96;line-height:1.7;text-align:left}
.small a{color:#5b8fff;text-decoration:none}
.ftr{padding:28px 40px;background:#09090f;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#52526e;text-align:center;line-height:2}
.ftr a{color:#5b8fff;text-decoration:none}
</style></head><body>
<div style="display:none;max-height:0;overflow:hidden;font-size:0">Your SmartCore verification code is ${esc(code)} — valid for 10 minutes.</div>
<div class="wrap">
  <div class="hdr">
    <div class="logo">
      <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" class="logo-mark" width="42" height="42" style="border-radius:12px;display:block" />
      <div><div class="logo-name">SmartCore</div><div class="logo-tag">Technology</div></div>
    </div>
  </div>
  <div class="body">
    <div class="tag">✉ Email Verification</div>
    <h1>Verify your email</h1>
    <p class="intro">Use the code below to confirm your email address<br>and complete your SmartCore account setup.</p>

    <div class="code-row">${digits}</div>
    <p class="code-plain">Or enter manually: <strong style="color:#8a8aae;letter-spacing:.15em">${esc(code)}</strong></p>

    <div class="notice">
      <p><strong>This code expires in 10 minutes.</strong> If you didn't request this, you can safely ignore this email — no account will be created.</p>
    </div>

    <div class="divider"></div>
    <p class="small">Verifying for: <a href="mailto:${esc(email)}">${esc(email)}</a><br>
    Questions? <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a></p>
  </div>
  <div class="ftr">
    SmartCore Technology &bull; <a href="${SITE}">${SITE.replace('https://','')}</a><br>
    <a href="mailto:support@smartcoretechnology.co.uk">support@smartcoretechnology.co.uk</a><br>
    <a href="${SITE}/privacy-policy.html">Privacy Policy</a> &bull; <a href="${SITE}/terms">Terms of Service</a>
  </div>
</div></body></html>`;
}
