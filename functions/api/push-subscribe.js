// POST /api/push-subscribe { subscription: PushSubscriptionJSON }
// DELETE /api/push-subscribe { endpoint }
// Platform-wide push subscription storage — not tied to any one module.
// Prompted from /modules/ ("alerts for modules and drills"); consumed by
// _push.js on behalf of whichever module wants to notify a signed-in user.
const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }});
}

async function getCallerUserId(request, env) {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const baseUrl = env.SUPABASE_URL || SUPABASE_URL;
  const res = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_KEY },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id || null;
}

function sb(env, path, method, body) {
  const baseUrl = env.SUPABASE_URL || SUPABASE_URL;
  return fetch(`${baseUrl}/rest/v1${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=minimal,resolution=merge-duplicates' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const subscription = body?.subscription;
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return json({ error: 'subscription.endpoint and subscription.keys.{p256dh,auth} are required' }, 400);

  const authUserId = await getCallerUserId(request, env);
  if (!authUserId) return json({ error: 'Unauthorized' }, 401);

  const res = await sb(env, '/core_push_subscriptions?on_conflict=endpoint', 'POST', {
    auth_user_id: authUserId,
    endpoint, p256dh, auth,
    user_agent: request.headers.get('User-Agent') || null,
    last_used_at: new Date().toISOString(),
  });

  if (!res.ok) return json({ error: 'Could not save subscription' }, 500);
  return json({ saved: true });
}

export async function onRequestDelete({ request, env }) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const endpoint = body?.endpoint;
  if (!endpoint) return json({ error: 'endpoint is required' }, 400);

  const authUserId = await getCallerUserId(request, env);
  if (!authUserId) return json({ error: 'Unauthorized' }, 401);

  const res = await sb(env, `/core_push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&auth_user_id=eq.${authUserId}`, 'DELETE');
  if (!res.ok) return json({ error: 'Could not remove subscription' }, 500);
  return json({ removed: true });
}
