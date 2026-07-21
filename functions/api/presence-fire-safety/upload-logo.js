import { json, options, getCallerProfile, hasPermission } from './_auth.js';

export const onRequestOptions = () => options();

const ALLOWED_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const MAX_SIZE = 15 * 1024 * 1024; // matches the presence-fire-safety-logos bucket's own limit

// Company logo upload, done server-side with the service-role key rather
// than direct client -> Supabase Storage. The permission check still goes
// through the caller's own token (hasPermission -> presence_fire_safety_has_permission
// RPC), so this isn't a shortcut around authorization — it just avoids the
// browser's direct storage upload, which kept failing RLS in the field for
// reasons that couldn't be reproduced server-side even with an identical
// simulated auth context.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    // Parse the multipart body before any other awaited network call — the
    // permission check below is itself a round-trip to Supabase, and
    // reading the body after that (rather than first) produced "No initial
    // boundary string" in the field, consistent with the request's body
    // stream not surviving that extra delay in the Workers runtime.
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return json({ error: 'file is required' }, 400);

    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    const allowed = await hasPermission(env, profile.token, profile.company_id, 'presence.manage_badges');
    if (!allowed) return json({ error: 'Forbidden' }, 403);

    const ext = ALLOWED_TYPES[file.type];
    if (!ext) return json({ error: 'Only JPEG, PNG, WebP, or SVG images are allowed' }, 400);
    if (file.size > MAX_SIZE) return json({ error: 'Image must be 15MB or smaller' }, 400);

    const bytes = await file.arrayBuffer();
    const path = `${profile.company_id}/logo.${ext}`;

    const uploadRes = await fetch(`${env.SUPABASE_URL}/storage/v1/object/presence-fire-safety-logos/${path}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': file.type,
        'x-upsert': 'true',
      },
      body: bytes,
    });
    if (!uploadRes.ok) return json({ error: 'Upload failed: ' + (await uploadRes.text()) }, 500);

    const url = `${env.SUPABASE_URL}/storage/v1/object/public/presence-fire-safety-logos/${path}?t=${Date.now()}`;
    return json({ url });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
