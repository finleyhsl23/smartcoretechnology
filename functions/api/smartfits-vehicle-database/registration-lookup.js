// Server-side proxy to the DVSA MOT History API. Runs server-side (not
// callable directly from the browser) because it needs a secret OAuth2
// client secret + API key, and the token exchange can't safely happen in the
// browser.
//
// This replaced an earlier DVLA Vehicle Enquiry Service (VES) integration —
// VES registration was unavailable, and MOT History has the added benefit of
// returning the vehicle's model as well as make (VES only returns make).
//
// Register for access at:
// https://documentation.history.mot.api.gov.uk/mot-history-api/register
// Approval issues four values, all required as Cloudflare Pages environment
// variables:
//   MOT_HISTORY_TENANT_ID      — Microsoft Entra ID tenant ID
//   MOT_HISTORY_CLIENT_ID      — OAuth2 client ID
//   MOT_HISTORY_CLIENT_SECRET  — OAuth2 client secret (rotates periodically —
//                                 DVSA emails a reminder 30/14 days before it expires)
//   MOT_HISTORY_API_KEY        — API key sent as the X-API-Key header
//
// Auth flow: client_credentials grant against Microsoft Entra ID to get a
// bearer token (valid ~60 min), then GET the vehicle by registration with
// both that bearer token AND the X-API-Key header.

import { json, options, getCallerProfile } from './_auth.js';

export const onRequestOptions = () => options();

const DEFAULT_SCOPE = 'https://tapi.dvsa.gov.uk/.default';
const REQUIRED_ENV = ['MOT_HISTORY_TENANT_ID', 'MOT_HISTORY_CLIENT_ID', 'MOT_HISTORY_CLIENT_SECRET', 'MOT_HISTORY_API_KEY'];

// Cached at module scope — best-effort only. Cloudflare may reuse this
// isolate across requests (saving a token round-trip) or spin up a fresh one
// at any time (falling back to a normal token fetch); either way is correct.
let _cachedToken = null;

async function getAccessToken(env) {
  if (_cachedToken && _cachedToken.expiresAt > Date.now() + 30000) return _cachedToken.token;

  const tokenRes = await fetch(`https://login.microsoftonline.com/${env.MOT_HISTORY_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.MOT_HISTORY_CLIENT_ID,
      client_secret: env.MOT_HISTORY_CLIENT_SECRET,
      scope: env.MOT_HISTORY_SCOPE || DEFAULT_SCOPE,
    }),
  });
  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenBody.access_token) {
    throw new Error(tokenBody.error_description || 'Could not authenticate with the MOT History API');
  }
  _cachedToken = { token: tokenBody.access_token, expiresAt: Date.now() + (tokenBody.expires_in || 3600) * 1000 };
  return _cachedToken.token;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    const missing = REQUIRED_ENV.filter(key => !env[key]);
    if (missing.length) {
      return json({ error: `Registration lookup is not configured yet. Ask an administrator to set: ${missing.join(', ')}.` }, 501);
    }

    const body = await request.json().catch(() => ({}));
    const registration = String(body.registration || '').toUpperCase().replace(/\s+/g, '');
    if (!registration) return json({ error: 'Registration is required' }, 400);

    const token = await getAccessToken(env);

    const motRes = await fetch(`https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(registration)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-API-Key': env.MOT_HISTORY_API_KEY,
      },
    });

    if (motRes.status === 404) {
      return json({ error: "No MOT history found for that registration — it may be a new vehicle that hasn't had its first MOT yet. Enter the details by hand." }, 404);
    }

    const motBody = await motRes.json().catch(() => ({}));
    if (!motRes.ok) {
      const message = motBody?.message || motBody?.errorMessage || 'Registration lookup failed';
      return json({ error: message }, motRes.status >= 400 && motRes.status < 500 ? 400 : 502);
    }

    return json(motBody);
  } catch (error) {
    return json({ error: error.message || String(error) }, 500);
  }
}
