// POST /api/sitesnap/push-subscribe { subscription: PushSubscriptionJSON }
// Upserts the caller's Push subscription (one row per browser/device — a
// person can have several) so send-push.js has somewhere to deliver to.
import { json, options, getCallerProfile, SUPABASE_URL } from './_auth.js';

export async function onRequestOptions() { return options(); }

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const subscription = body?.subscription;
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return json({ error: 'subscription.endpoint and subscription.keys.{p256dh,auth} are required' }, 400);

  const caller = await getCallerProfile(request, env);
  if (!caller) return json({ error: 'Unauthorized' }, 401);

  const baseUrl = env.SUPABASE_URL || SUPABASE_URL;
  // Upsert on the unique endpoint column — merge-duplicates so re-subscribing
  // the same device (e.g. after the browser refreshes the subscription)
  // updates the row in place instead of erroring on the unique constraint.
  const res = await fetch(`${baseUrl}/rest/v1/sitesnap_push_subscriptions?on_conflict=endpoint`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      employee_id: caller.id,
      company_id: caller.company_id,
      endpoint, p256dh, auth,
      user_agent: request.headers.get('User-Agent') || null,
      last_used_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) return json({ error: 'Could not save subscription' }, 500);
  return json({ saved: true });
}
