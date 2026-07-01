// POST /api/nova/shopping
// Body: { content: string }  — saves updated shopping list content

const SUPABASE_URL  = 'https://hjdpcfhozhoyeqevnupm.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhqZHBjZmhvemhveWVxZXZudXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MTk3MzYsImV4cCI6MjA4MjQ5NTczNn0.BXosJO4NmEZOe73GXSGPa3z-i_4ZzF9zBAMBIf6Mkts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestPost(ctx) {
  const { env, request } = ctx;
  const token = request.headers.get('Authorization')?.replace('Bearer ', '').trim();
  if (!token) return new Response('Unauthorized', { status: 401, headers: cors });

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return new Response('Unauthorized', { status: 401, headers: cors });
  const user = await userRes.json();

  const svcHdr = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  const { content } = await request.json().catch(() => ({}));
  const base = `${SUPABASE_URL}/rest/v1`;

  const existing = await fetch(`${base}/nova_notes?user_id=eq.${user.id}&title=eq.Shopping List&limit=1`, { headers: svcHdr })
    .then(r => r.json()).catch(() => []);

  if (existing?.length) {
    await fetch(`${base}/nova_notes?id=eq.${existing[0].id}&user_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { ...svcHdr, Prefer: 'return=minimal' },
      body: JSON.stringify({ content }),
    });
  } else {
    const profRes = await fetch(`${base}/user_profiles?user_id=eq.${user.id}&select=company_id&limit=1`, { headers: svcHdr });
    const prof = await profRes.json().catch(() => []);
    await fetch(`${base}/nova_notes`, {
      method: 'POST',
      headers: { ...svcHdr, Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: user.id, company_id: prof?.[0]?.company_id, title: 'Shopping List', content, tags: ['shopping'] }),
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: { ...cors, 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
  });
}
