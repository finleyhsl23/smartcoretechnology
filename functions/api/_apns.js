// Native push via Apple Push Notification service (APNs) HTTP/2 API, for
// the Capacitor-wrapped iOS app (com.smartcoretechnology.app) — separate
// from _webpush.js, which only reaches browsers/PWAs. Same token-based auth
// shape as VAPID (an ES256 JWT signed with a private key, WebCrypto only,
// no npm dependency), just against Apple's endpoint instead of a Web Push
// service. See core_apns_device_tokens (added by
// supabase/migrations/20260817130000_core_apns_device_tokens.sql) for where
// device tokens registered via the native PushNotifications plugin land.

const DEFAULT_BUNDLE_ID = "com.smartcoretechnology.app";

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem) {
  const body = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let _keyPromise = null;
let _keyId = null;
function importApnsKey(env) {
  if (!_keyPromise || _keyId !== env.APNS_KEY_ID) {
    _keyId = env.APNS_KEY_ID;
    _keyPromise = crypto.subtle.importKey(
      "pkcs8",
      pemToDer(env.APNS_AUTH_KEY),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
  }
  return _keyPromise;
}

// Apple's guidance is to cache this token for up to ~55 minutes rather than
// mint one per request — a fresh signature every call works too (it's what
// _webpush.js's VAPID header does) but this avoids the extra sign() when
// sending to many devices in the same request.
let _cachedToken = null;
let _cachedTokenExp = 0;
async function buildApnsAuthToken(env) {
  if (_cachedToken && Date.now() < _cachedTokenExp) return _cachedToken;

  const header = { alg: "ES256", kid: env.APNS_KEY_ID };
  const payload = { iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) };
  const encoder = new TextEncoder();
  const signingInput = `${bytesToB64url(encoder.encode(JSON.stringify(header)))}.${bytesToB64url(encoder.encode(JSON.stringify(payload)))}`;

  const key = await importApnsKey(env);
  const sigBuf = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signingInput));
  _cachedToken = `${signingInput}.${bytesToB64url(new Uint8Array(sigBuf))}`;
  _cachedTokenExp = Date.now() + 50 * 60 * 1000;
  return _cachedToken;
}

/**
 * Sends one native push to one APNs device token. Returns { ok, status,
 * reason }. A 400 "BadDeviceToken" or 410 "Unregistered" means the token is
 * dead and should be deleted by the caller.
 */
export async function sendApnsPush(env, { deviceToken, environment }, { title, body, url }) {
  const host = environment === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com";
  const jwt = await buildApnsAuthToken(env);
  const bundleId = env.APNS_BUNDLE_ID || DEFAULT_BUNDLE_ID;

  const res = await fetch(`https://${host}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: { alert: { title, body: body || "" }, sound: "default" },
      url: url || "/modules/",
    }),
  });

  let reason = null;
  if (!res.ok) {
    try { reason = (await res.json())?.reason || null; } catch { /* no body */ }
  }
  return { ok: res.ok, status: res.status, reason };
}
