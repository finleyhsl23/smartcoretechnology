import { json, options, getCallerProfile, sbGet } from './_auth.js';

const BUCKET = 'employee-avatars';

export const onRequestOptions = () => options();

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorised' }, 401);

    const form = await request.formData();
    const file = form.get('file');
    const employeeId = form.get('employee_id') || null;

    if (!file || typeof file === 'string') return json({ error: 'file required' }, 400);

    const ext = (file.name || 'jpg').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];
    if (!allowedExts.includes(ext)) return json({ error: 'Invalid file type' }, 400);
    if (file.size > 20 * 1024 * 1024) return json({ error: 'File must be under 20 MB' }, 400);

    let targetId;
    if (employeeId) {
      // Admin uploading for another employee
      if (!['admin', 'owner'].includes(profile.role)) return json({ error: 'Forbidden' }, 403);
      const emps = await sbGet(env, `/core_employees?id=eq.${encodeURIComponent(employeeId)}&company_id=eq.${encodeURIComponent(profile.company_id)}&select=id&limit=1`);
      if (!emps?.length) return json({ error: 'Employee not found' }, 404);
      targetId = employeeId;
    } else {
      // Employee uploading their own photo
      const emps = await sbGet(env, `/core_employees?auth_user_id=eq.${encodeURIComponent(profile.auth_id)}&company_id=eq.${encodeURIComponent(profile.company_id)}&select=id&limit=1`);
      if (!emps?.length) return json({ error: 'Employee record not found' }, 404);
      targetId = emps[0].id;
    }

    // Ensure bucket exists
    await fetch(`${env.SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 20971520 }),
    });
    // Ignore error — bucket may already exist

    const storagePath = `${profile.company_id}/${targetId}.${ext}`;

    // Upload (upsert) — read into buffer first so the body isn't a stream
    const fileBytes = await file.arrayBuffer();
    const uploadRes = await fetch(
      `${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': file.type || 'image/jpeg',
          'x-upsert': 'true',
        },
        body: fileBytes,
      }
    );
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error('Storage upload failed: ' + err);
    }

    // Add cache-buster so browsers pick up the new image immediately
    const ts = Date.now();
    const publicUrl = `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}?t=${ts}`;

    // Patch the employee record
    const patchRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/core_employees?id=eq.${encodeURIComponent(targetId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ profile_picture_url: publicUrl }),
      }
    );
    if (!patchRes.ok) {
      const err = await patchRes.text();
      // If column missing, return the URL anyway — admin can add the column
      console.error('profile_picture_url patch failed:', err);
      return json({ url: publicUrl, warning: 'DB update failed — ensure profile_picture_url column exists on core_employees' });
    }

    return json({ url: publicUrl });
  } catch (e) {
    console.error('upload-avatar:', e);
    return json({ error: e.message }, 500);
  }
}
