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
