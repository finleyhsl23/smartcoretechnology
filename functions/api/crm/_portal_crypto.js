// PBKDF2 password hashing + JWT signing via Web Crypto (works in Cloudflare Workers)

const ENC = new TextEncoder();

// ── Password hashing ──────────────────────────────────────────────────────────

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await pbkdf2Key(password, salt);
  const hash = await crypto.subtle.exportKey("raw", key);
  return `pbkdf2:100000:${b64(salt)}:${b64(new Uint8Array(hash))}`;
}

export async function verifyPassword(password, stored) {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const salt = unb64(parts[2]);
  const expected = unb64(parts[3]);
  const key = await pbkdf2Key(password, salt);
  const derived = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  if (derived.length !== expected.length) return false;
  // Constant-time compare
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}

async function pbkdf2Key(password, salt) {
  const baseKey = await crypto.subtle.importKey("raw", ENC.encode(password), "PBKDF2", false, ["deriveBits","deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"]
  );
}

// ── JWT (HMAC-SHA256) ─────────────────────────────────────────────────────────

export async function signJWT(payload, secret) {
  const header  = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body    = b64url(JSON.stringify(payload));
  const signingKey = await crypto.subtle.importKey("raw", ENC.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", signingKey, ENC.encode(`${header}.${body}`));
  return `${header}.${body}.${b64urlRaw(new Uint8Array(sig))}`;
}

export async function verifyJWT(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const signingKey = await crypto.subtle.importKey("raw", ENC.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", signingKey, unb64url(parts[2]), ENC.encode(`${parts[0]}.${parts[1]}`));
  if (!valid) return null;
  const payload = JSON.parse(atob(parts[1].replace(/-/g,"+").replace(/_/g,"/")));
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64(buf)       { return btoa(String.fromCharCode(...buf)); }
function unb64(s)       { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function b64url(s)      { return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""); }
function b64urlRaw(buf) { return b64(buf).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""); }
function unb64url(s)    { return unb64(s.replace(/-/g,"+").replace(/_/g,"/")); }
