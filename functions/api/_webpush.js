// Web Push sender, implemented from scratch against RFC 8291 (message
// encryption, aes128gcm) and RFC 8292 (VAPID) using only the Web Crypto API
// (crypto.subtle) — there is no build step for Cloudflare Pages Functions in
// this repo, so the npm `web-push` package isn't available here; Web Crypto
// is natively supported in the Workers runtime with no dependency needed.
//
// Platform-wide (not module-specific) — any module's Function can send a
// push via sendWebPush(env, subscription, payload). See _push.js for the
// higher-level "send to a list of signed-in users" helper.

function b64urlToBytes(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const base64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, dataBytes);
  return new Uint8Array(sig);
}

// HKDF-Expand, single-block (all lengths we need are <= 32 bytes, so one
// HMAC block is always sufficient — no need for the general multi-block form).
async function hkdfExpand(prk, info, length) {
  const t1 = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return t1.slice(0, length);
}

// ── VAPID (RFC 8292) ────────────────────────────────────────────────────
async function importVapidPrivateKey(vapidPublicKeyB64url, vapidPrivateKeyB64url) {
  const pub = b64urlToBytes(vapidPublicKeyB64url); // 65 bytes: 0x04 || X(32) || Y(32)
  const x = pub.slice(1, 33);
  const y = pub.slice(33, 65);
  const jwk = {
    kty: "EC", crv: "P-256", ext: true,
    x: bytesToB64url(x), y: bytesToB64url(y), d: vapidPrivateKeyB64url,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function buildVapidAuthHeader(env, endpointUrl) {
  const aud = new URL(endpointUrl).origin;
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:support@smartcoretechnology.co.uk" };
  const encoder = new TextEncoder();
  const signingInput = `${bytesToB64url(encoder.encode(JSON.stringify(header)))}.${bytesToB64url(encoder.encode(JSON.stringify(payload)))}`;

  const key = await importVapidPrivateKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  // Web Crypto's ECDSA signatures are raw (r || s), which is exactly what
  // JWS ES256 requires — unlike Node's crypto, there is no DER re-encoding step.
  const sigBuf = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signingInput));
  const jwt = `${signingInput}.${bytesToB64url(new Uint8Array(sigBuf))}`;

  return `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
}

// ── Payload encryption (RFC 8291, aes128gcm content coding per RFC 8188) ──
async function encryptPayload({ p256dh, auth }, plaintextBytes) {
  const uaPublic = b64urlToBytes(p256dh); // subscriber's public key, 65 bytes
  const authSecret = b64urlToBytes(auth); // subscriber's auth secret, 16 bytes

  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));

  const uaPublicKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, asKeyPair.privateKey, 256));

  const encoder = new TextEncoder();
  const keyInfo = concatBytes(encoder.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublicRaw);
  const prkKey = await hmacSha256(authSecret, ecdhSecret);       // HKDF-Extract(salt=auth_secret, ikm=ecdh_secret)
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);              // HKDF-Expand -> 32-byte IKM for the next stage

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);                        // HKDF-Extract(salt=salt, ikm=ikm)
  const cek = await hkdfExpand(prk, concatBytes(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdfExpand(prk, concatBytes(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  // Single-record aes128gcm body: plaintext + a 0x02 delimiter (marks this
  // as the final — and only — record), then AES-128-GCM (tag included).
  const padded = concatBytes(plaintextBytes, new Uint8Array([2]));
  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, padded));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, ciphertext.length, false);
  const header = concatBytes(salt, recordSize, new Uint8Array([asPublicRaw.length]), asPublicRaw);

  return concatBytes(header, ciphertext);
}

/**
 * Sends one Web Push message to one subscription. Returns { ok, status }.
 * A 404/410 status means the subscription is gone and should be deleted by
 * the caller — every other outcome is worth logging but not fatal to retry.
 *
 * `urgency` (RFC 8030 "Urgency" header — very-low/low/normal/high) is a
 * push-protocol-level hint the browser vendor's push service uses to decide
 * whether to wake a battery-saving device immediately; it is NOT the same
 * thing as iOS's native "Critical Alert" (which bypasses silent mode/DND
 * and requires a special Apple entitlement unavailable to Web Push).
 */
export async function sendWebPush(env, subscription, payloadObj, { urgency = "normal" } = {}) {
  const body = await encryptPayload(subscription, new TextEncoder().encode(JSON.stringify(payloadObj)));
  const authHeader = await buildVapidAuthHeader(env, subscription.endpoint);

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Urgency: urgency,
      Authorization: authHeader,
    },
    body,
  });
  return { ok: res.ok, status: res.status };
}
