// POST /api/nova/google
// Body: { action: 'status' | 'auth_url' | 'exchange' | 'disconnect', code?: string }
// Auth: Bearer <supabase access token>

import {
  SUPABASE_URL, GOOGLE_SCOPES, redirectUri, json,
  authenticate, getConnection,
} from './_google.js';

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await authenticate(request, env);
    if (auth.error) return json({ ok: false, error: auth.error }, auth.status);
    const { userId, companyId, svcHdr } = auth;

    const body = await request.json().catch(() => ({}));
    const action = body.action;

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return json({ ok: false, error: 'Google integration is not configured on this server.' }, 500);
    }

    // ── Current connection state ──────────────────────────────────────────
    if (action === 'status') {
      const conn = await getConnection(userId, svcHdr);
      if (!conn) return json({ ok: true, connected: false });
      return json({
        ok: true,
        connected: true,
        email: conn.google_email,
        scopes: conn.scopes,
        connected_at: conn.connected_at,
      });
    }

    // ── Build the consent URL ─────────────────────────────────────────────
    if (action === 'auth_url') {
      const state = crypto.randomUUID();
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      url.searchParams.set('redirect_uri', redirectUri(request));
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', GOOGLE_SCOPES);
      url.searchParams.set('access_type', 'offline');   // needed for a refresh token
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('include_granted_scopes', 'true');
      url.searchParams.set('state', state);
      return json({ ok: true, url: url.toString(), state });
    }

    // ── Swap the code for tokens ──────────────────────────────────────────
    if (action === 'exchange') {
      if (!body.code) return json({ ok: false, error: 'Missing code' }, 400);

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          code: body.code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri(request),
        }),
      });

      const tokens = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !tokens.access_token) {
        return json({ ok: false, error: tokens.error_description || 'Could not connect to Google.' }, 400);
      }

      // Find out which account was actually authorised.
      let email = null;
      try {
        const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (infoRes.ok) email = (await infoRes.json())?.email || null;
      } catch (_) {}

      const existing = await getConnection(userId, svcHdr);
      const row = {
        user_id:      userId,
        company_id:   companyId,
        google_email: email,
        access_token: tokens.access_token,
        // Google only returns a refresh token on first consent — keep the old one otherwise.
        refresh_token: tokens.refresh_token || existing?.refresh_token || null,
        scopes:       tokens.scope || GOOGLE_SCOPES,
        expires_at:   new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
        updated_at:   new Date().toISOString(),
      };

      const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/nova_google_tokens`, {
        method: 'POST',
        headers: { ...svcHdr, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(row),
      });
      if (!saveRes.ok) {
        return json({ ok: false, error: 'Connected to Google but could not save the connection.' }, 500);
      }

      return json({ ok: true, connected: true, email });
    }

    // ── Revoke and forget ─────────────────────────────────────────────────
    if (action === 'disconnect') {
      const conn = await getConnection(userId, svcHdr);
      if (conn?.refresh_token) {
        try {
          await fetch('https://oauth2.googleapis.com/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: conn.refresh_token }),
          });
        } catch (_) {}
      }
      await fetch(`${SUPABASE_URL}/rest/v1/nova_google_tokens?user_id=eq.${userId}`, {
        method: 'DELETE',
        headers: svcHdr,
      });
      return json({ ok: true, connected: false });
    }

    return json({ ok: false, error: 'Unknown action' }, 400);
  } catch (e) {
    console.error('Nova google error:', e);
    return json({ ok: false, error: e.message }, 500);
  }
}
