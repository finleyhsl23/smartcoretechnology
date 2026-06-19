/**
 * POST /api/verify-code
 * Validates the 6-digit code, creates/confirms the Supabase user, returns session.
 * Body: { email: string, code: string, password: string }
 */

const SUPABASE_URL      = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return json({ error: 'Service not configured' }, 500);

    const { email, code, password } = await request.json();
    if (!email || !code || !password) return json({ error: 'email, code, and password required' }, 400);

    // Look up the verification code
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/verification_codes?email=eq.${encodeURIComponent(email)}&used=eq.false&order=created_at.desc&limit=1`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    const rows = await r.json();
    const row = rows?.[0];

    if (!row) return json({ error: 'No verification code found. Please request a new one.' }, 400);
    if (row.code !== code.trim()) return json({ error: 'Incorrect code. Please check and try again.' }, 400);
    if (new Date(row.expires_at) < new Date()) return json({ error: 'Code has expired. Please request a new one.' }, 400);

    // Verify password matches what was used when requesting the code
    const pwHash = await sha256(password);
    if (row.password_hash !== pwHash) return json({ error: 'Password does not match. Please request a new code.' }, 400);

    // Mark code as used
    await fetch(
      `${SUPABASE_URL}/rest/v1/verification_codes?id=eq.${row.id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ used: true }),
      }
    );

    // Try to sign up the user (creates account with email confirmed via admin API)
    // First, create user with admin API (email_confirm: true bypasses email confirmation)
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });

    let userId;
    if (createRes.ok) {
      const created = await createRes.json();
      userId = created.id;
    } else {
      const errBody = await createRes.json();
      // If user already exists, that's fine — just sign them in
      if (errBody?.msg?.includes('already been registered') || errBody?.code === 'email_exists' || createRes.status === 422) {
        // User exists — sign them in below
      } else {
        return json({ error: errBody?.msg || 'Failed to create account' }, 400);
      }
    }

    // Sign in to get a session
    const signinRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!signinRes.ok) {
      const e = await signinRes.json();
      return json({ error: e?.error_description || e?.msg || 'Sign-in failed after verification' }, 400);
    }

    const session = await signinRes.json();
    return json({ success: true, session, user_id: session.user?.id || userId }, 200);

  } catch (err) {
    console.error('verify-code error:', err);
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
