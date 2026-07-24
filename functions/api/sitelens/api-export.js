// GET /api/sitelens/api-export
// Header: X-API-Key: sl_live_...
// Read-only export for external tools: active projects and recent media
// (with short-lived signed URLs) for the key's company. This is SiteLens's
// integration surface alongside outbound webhooks (webhook-notify.js) — a
// generic, always-available alternative to bespoke per-vendor OAuth, which
// no module on this platform has infrastructure for today.
import { json, options, sbGet, sbPatch, sha256Hex } from './_auth.js';

export async function onRequestOptions() { return options(); }

export async function onRequestGet({ request, env }) {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey) return json({ error: 'Missing X-API-Key header' }, 401);

  const keyHash = await sha256Hex(apiKey);
  let keyRows;
  try {
    keyRows = await sbGet(env, `/sitelens_api_keys?key_hash=eq.${keyHash}&select=*&limit=1`);
  } catch {
    return json({ error: 'Lookup failed' }, 500);
  }
  const keyRow = keyRows?.[0];
  if (!keyRow || keyRow.revoked_at) return json({ error: 'Invalid or revoked API key' }, 401);

  await sbPatch(env, `/sitelens_api_keys?id=eq.${keyRow.id}`, { last_used_at: new Date().toISOString() }).catch(() => {});

  const companyId = keyRow.company_id;
  const [projectRows, mediaRows] = await Promise.all([
    sbGet(env, `/sitelens_projects?company_id=eq.${companyId}&status=eq.active&select=id,name,client_name,status,city,postcode,created_at&order=created_at.desc`),
    sbGet(env, `/sitelens_media?company_id=eq.${companyId}&select=id,project_id,media_type,caption,taken_at,latitude,longitude,storage_path&order=taken_at.desc&limit=100`),
  ]);

  const signedMedia = await Promise.all(mediaRows.map(async (m) => ({
    ...m,
    storage_path: undefined,
    url: await createSignedUrl(env, m.storage_path),
  })));

  return json({ projects: projectRows, media: signedMedia });
}

async function createSignedUrl(env, path) {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/sitelens-media/${path}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.signedURL ? `${env.SUPABASE_URL}/storage/v1${data.signedURL}` : null;
  } catch {
    return null;
  }
}
