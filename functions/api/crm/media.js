const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const BUCKET = 'crm-media';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function getTenanId(token, SERVICE_KEY) {
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return null;
  const { id: authUserId } = await userRes.json();
  const empRes = await fetch(`${SUPABASE_URL}/rest/v1/core_employees?auth_user_id=eq.${authUserId}&select=company_id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const [emp] = await empRes.json();
  return emp?.company_id || null;
}

export async function onRequestPost({ request, env }) {
  const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  const token = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (!token) return json({ error: 'Unauthorised' }, 401);

  const tenantId = await getTenanId(token, SERVICE_KEY);
  if (!tenantId) return json({ error: 'Unauthorised' }, 401);

  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  const hj = { ...h, 'Content-Type': 'application/json' };

  const body = await request.json();
  const { action } = body;

  // ── List companies ──────────────────────────────────────────────────────────
  if (action === 'list_companies') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_companies?tenant_id=eq.${tenantId}&select=id,name&order=name.asc&limit=500`, { headers: h });
    return json({ companies: await res.json() });
  }

  // ── Folders ─────────────────────────────────────────────────────────────────
  if (action === 'list_folders') {
    const { company_id, parent_folder_id } = body;
    let url = `${SUPABASE_URL}/rest/v1/crm_media_folders?tenant_id=eq.${tenantId}&order=name.asc`;
    if (company_id) url += `&company_id=eq.${company_id}`;
    if (parent_folder_id) url += `&parent_folder_id=eq.${parent_folder_id}`;
    else url += `&parent_folder_id=is.null`;
    if (!company_id && !parent_folder_id) url += `&company_id=is.null`;
    const res = await fetch(url, { headers: h });
    return json({ folders: await res.json() });
  }

  if (action === 'create_folder') {
    const { name, company_id, parent_folder_id } = body;
    if (!name?.trim()) return json({ error: 'Name required' }, 400);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_media_folders`, {
      method: 'POST', headers: { ...hj, Prefer: 'return=representation' },
      body: JSON.stringify({ tenant_id: tenantId, name: name.trim(), company_id: company_id || null, parent_folder_id: parent_folder_id || null }),
    });
    const [folder] = await res.json();
    return json({ folder });
  }

  if (action === 'delete_folder') {
    const { folder_id } = body;
    if (!folder_id) return json({ error: 'folder_id required' }, 400);
    // Verify ownership
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/crm_media_folders?id=eq.${folder_id}&tenant_id=eq.${tenantId}&select=id&limit=1`, { headers: h });
    const [f] = await chk.json();
    if (!f) return json({ error: 'Not found' }, 404);
    // Get all files to delete from storage
    const filesRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_media_files?folder_id=eq.${folder_id}&select=storage_path`, { headers: h });
    const files = await filesRes.json();
    if (files?.length) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE', headers: hj,
        body: JSON.stringify({ prefixes: files.map(f => f.storage_path) }),
      });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/crm_media_folders?id=eq.${folder_id}`, { method: 'DELETE', headers: h });
    return json({ success: true });
  }

  // ── Files ────────────────────────────────────────────────────────────────────
  if (action === 'list_files') {
    const { folder_id } = body;
    if (!folder_id) return json({ error: 'folder_id required' }, 400);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_media_files?folder_id=eq.${folder_id}&tenant_id=eq.${tenantId}&order=created_at.desc`, { headers: h });
    return json({ files: await res.json() });
  }

  if (action === 'create_upload_url') {
    const { folder_id, filename, file_type } = body;
    if (!folder_id || !filename) return json({ error: 'folder_id and filename required' }, 400);
    // Verify folder belongs to tenant
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/crm_media_folders?id=eq.${folder_id}&tenant_id=eq.${tenantId}&select=id&limit=1`, { headers: h });
    const [f] = await chk.json();
    if (!f) return json({ error: 'Folder not found' }, 404);

    const storagePath = `${tenantId}/${folder_id}/${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${storagePath}`, {
      method: 'POST', headers: hj, body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!signRes.ok) return json({ error: 'Failed to create upload URL' }, 500);
    const signData = await signRes.json();
    return json({ upload_url: `${SUPABASE_URL}/storage/v1${signData.url}`, storage_path: storagePath });
  }

  if (action === 'confirm_upload') {
    const { folder_id, name, file_type, file_size, storage_path } = body;
    if (!folder_id || !name || !storage_path) return json({ error: 'Missing fields' }, 400);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_media_files`, {
      method: 'POST', headers: { ...hj, Prefer: 'return=representation' },
      body: JSON.stringify({ tenant_id: tenantId, folder_id, name, file_type: file_type || null, file_size: file_size || null, storage_path }),
    });
    const [file] = await res.json();
    return json({ file });
  }

  if (action === 'get_signed_url') {
    const { file_id } = body;
    const fileRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_media_files?id=eq.${file_id}&tenant_id=eq.${tenantId}&select=*&limit=1`, { headers: h });
    const [file] = await fileRes.json();
    if (!file) return json({ error: 'Not found' }, 404);

    const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${file.storage_path}`, {
      method: 'POST', headers: hj, body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!signRes.ok) return json({ error: 'Failed to create signed URL' }, 500);
    const { signedURL } = await signRes.json();
    return json({ url: `${SUPABASE_URL}/storage/v1${signedURL}`, file });
  }

  if (action === 'delete_file') {
    const { file_id } = body;
    const fileRes = await fetch(`${SUPABASE_URL}/rest/v1/crm_media_files?id=eq.${file_id}&tenant_id=eq.${tenantId}&select=storage_path&limit=1`, { headers: h });
    const [file] = await fileRes.json();
    if (!file) return json({ error: 'Not found' }, 404);
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE', headers: hj, body: JSON.stringify({ prefixes: [file.storage_path] }),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/crm_media_files?id=eq.${file_id}`, { method: 'DELETE', headers: h });
    return json({ success: true });
  }

  // ── Directory ─────────────────────────────────────────────────────────────────
  if (action === 'list_directory') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_directory?tenant_id=eq.${tenantId}&order=sort_order.asc,name.asc`, { headers: h });
    return json({ entries: await res.json() });
  }

  if (action === 'save_directory_entry') {
    const { id, name, job_title, email, phone, sort_order } = body;
    if (!name?.trim()) return json({ error: 'Name required' }, 400);
    const data = { name: name.trim(), job_title: job_title || null, email: email || null, phone: phone || null, sort_order: sort_order ?? 0 };
    if (id) {
      const chk = await fetch(`${SUPABASE_URL}/rest/v1/crm_directory?id=eq.${id}&tenant_id=eq.${tenantId}&select=id&limit=1`, { headers: h });
      const [e] = await chk.json();
      if (!e) return json({ error: 'Not found' }, 404);
      await fetch(`${SUPABASE_URL}/rest/v1/crm_directory?id=eq.${id}`, { method: 'PATCH', headers: hj, body: JSON.stringify(data) });
      return json({ success: true });
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/crm_directory`, {
      method: 'POST', headers: { ...hj, Prefer: 'return=representation' },
      body: JSON.stringify({ tenant_id: tenantId, ...data }),
    });
    const [entry] = await res.json();
    return json({ entry });
  }

  if (action === 'delete_directory_entry') {
    const { id } = body;
    const chk = await fetch(`${SUPABASE_URL}/rest/v1/crm_directory?id=eq.${id}&tenant_id=eq.${tenantId}&select=id&limit=1`, { headers: h });
    const [e] = await chk.json();
    if (!e) return json({ error: 'Not found' }, 404);
    await fetch(`${SUPABASE_URL}/rest/v1/crm_directory?id=eq.${id}`, { method: 'DELETE', headers: h });
    return json({ success: true });
  }

  if (action === 'toggle_directory') {
    const { enabled } = body;
    await fetch(`${SUPABASE_URL}/rest/v1/crm_settings?tenant_id=eq.${tenantId}`, {
      method: 'PATCH', headers: hj, body: JSON.stringify({ directory_enabled: !!enabled }),
    });
    return json({ success: true });
  }

  return json({ error: 'Unknown action' }, 400);
}
