// Signs Supabase-compatible session JWTs for kiosk device identities that
// deliberately have NO real Supabase Auth user behind them — see
// devices-register.js. PostgREST/RLS only care that a request carries a
// validly-signed JWT with the right claim shape (sub -> auth.uid(), role ->
// which Postgres role the request runs as); nothing in Supabase actually
// requires that JWT to have been issued by GoTrue, or that `sub` correspond
// to a row in auth.users — core_employees.auth_user_id has no FK to
// auth.users, confirmed before building this. Same ES256-JWT experience as
// the VAPID/APNs signing built earlier this session, just HS256 (symmetric,
// no key pair) since that's what Supabase's own JWT secret uses.
//
// There is deliberately no refresh-token mechanism here — these tokens are
// long-lived (7 days) instead, and the kiosk recovery flow (kiosk-start.js,
// hit whenever Fully Kiosk Browser reloads its Start URL) re-mints a fresh
// one well before that, rather than building a parallel refresh system.
const KIOSK_JWT_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

function base64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signKioskJwt(env, authUserId) {
  const encoder = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "authenticated",
    role: "authenticated",
    sub: authUserId,
    iat: now,
    exp: now + KIOSK_JWT_LIFETIME_SECONDS,
  };

  const signingInput = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SUPABASE_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(sigBuf))}`;
}

export async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64urlToBytes(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Verifies a Supabase-shaped access token's HMAC signature and expiry
// LOCALLY, without calling Supabase Auth's /auth/v1/user endpoint. That
// endpoint verifies the JWT's signature the same way, but ALSO looks up
// `sub` in auth.users and rejects the token if no such row exists — which
// is exactly true of every kiosk identity by design (see devices-register.js).
// Both real employee sessions and kiosk sessions are HS256-signed with the
// same project JWT secret, so this one local check works for both, and is
// what every presence-fire-safety API endpoint should use to resolve the
// caller instead of asking GoTrue (see _auth.js's getCallerProfile).
export async function verifyJwt(env, token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(env.SUPABASE_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64urlToBytes(sigB64),
    encoder.encode(`${headerB64}.${payloadB64}`)
  );
  if (!valid) return null;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(payloadB64)));
  } catch {
    return null;
  }
  if (!payload?.sub) return null;
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
