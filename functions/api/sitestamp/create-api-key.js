// POST /api/sitestamp/create-api-key { companyId, label }
// Creates a read-only SiteStamp export API key. The raw key is returned once
// in the response and never stored — only its SHA-256 hash is persisted, so
// it can be looked up (but not recovered) by functions/api/sitestamp/api-export.js.
import { json, options, getCallerProfile, hasPermission, sbPost, sha256Hex } from './_auth.js';

export async function onRequestOptions() { return options(); }

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { companyId, label } = body || {};
  if (!companyId || !label) return json({ error: 'companyId and label are required' }, 400);

  const caller = await getCallerProfile(request, env);
  if (!caller) return json({ error: 'Unauthorized' }, 401);
  if (caller.company_id !== companyId) return json({ error: 'Forbidden' }, 403);

  const allowed = await hasPermission(env, caller.token, companyId, 'sitestamp.manage_settings');
  if (!allowed) return json({ error: 'You do not have permission to manage SiteStamp settings.' }, 403);

  const rawKey = `sl_live_${crypto.randomUUID().replace(/-/g, '')}`;
  const keyHash = await sha256Hex(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  try {
    await sbPost(env, '/sitestamp_api_keys', {
      company_id: companyId, label, key_prefix: keyPrefix, key_hash: keyHash, created_by: caller.id,
    });
  } catch (e) {
    return json({ error: 'Could not create API key.' }, 500);
  }

  return json({ apiKey: rawKey, keyPrefix });
}
