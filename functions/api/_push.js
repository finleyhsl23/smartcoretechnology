// Platform-wide "send an alert to whichever devices these people are
// signed in on" helper. Generic on purpose — any module's server-side
// Function can import sendPushToUsers() to notify a list of auth user ids;
// it isn't specific to any one module's data model. See _webpush.js for the
// actual VAPID/encryption implementation and core_push_subscriptions (added
// by supabase/migrations/20260817120000_core_push_subscriptions.sql) for
// where subscriptions are stored.
import { sendWebPush } from './_webpush.js';

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

function sb(env, path, method = 'GET') {
  const baseUrl = env.SUPABASE_URL || SUPABASE_URL;
  return fetch(`${baseUrl}/rest/v1${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Sends a push notification to every device each of `authUserIds` has
 * subscribed on. Best-effort per-subscription: a dead subscription
 * (404/410) is deleted, everything else is just counted. Never throws —
 * callers should treat this as fire-and-forget alongside whatever action
 * triggered it (an evacuation starting, etc).
 */
export async function sendPushToUsers(env, authUserIds, { title, body, url, urgency, requireInteraction }) {
  const ids = [...new Set((authUserIds || []).filter(Boolean))];
  if (!ids.length || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return { sent: 0, removed: 0, failed: 0, total: 0 };
  }

  let subscriptions = [];
  try {
    const res = await sb(env, `/core_push_subscriptions?auth_user_id=in.(${ids.join(',')})&select=*`);
    if (res.ok) subscriptions = await res.json();
  } catch {
    return { sent: 0, removed: 0, failed: 0, total: 0 };
  }

  const payload = { title, body: body || '', url: url || '/modules/', requireInteraction: !!requireInteraction };
  let sent = 0, removed = 0, failed = 0;

  await Promise.all(subscriptions.map(async (subRow) => {
    try {
      const result = await sendWebPush(env, subRow, payload, { urgency });
      if (result.ok) {
        sent++;
      } else if (result.status === 404 || result.status === 410) {
        await sb(env, `/core_push_subscriptions?id=eq.${subRow.id}`, 'DELETE').catch(() => {});
        removed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }));

  return { sent, removed, failed, total: subscriptions.length };
}
