// Platform-wide "send an alert to whichever devices these people are
// signed in on" helper. Generic on purpose — any module's server-side
// Function can import sendPushToUsers() to notify a list of auth user ids;
// it isn't specific to any one module's data model. Fans out over BOTH
// channels a person might be reachable on:
//  - Standard Web Push (browsers/PWAs) — see _webpush.js and
//    core_push_subscriptions (20260817120000_core_push_subscriptions.sql).
//  - Native APNs (the Capacitor-wrapped iOS app) — see _apns.js and
//    core_apns_device_tokens (20260817130000_core_apns_device_tokens.sql).
import { sendWebPush } from './_webpush.js';
import { sendApnsPush } from './_apns.js';

const SUPABASE_URL = 'https://hjdpcfhozhoyeqevnupm.supabase.co';

function sb(env, path, method = 'GET', body) {
  const baseUrl = env.SUPABASE_URL || SUPABASE_URL;
  return fetch(`${baseUrl}/rest/v1${path}`, {
    method,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function sendWebPushToUsers(env, ids, message) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { sent: 0, removed: 0, failed: 0, total: 0 };

  let subscriptions = [];
  try {
    const res = await sb(env, `/core_push_subscriptions?auth_user_id=in.(${ids.join(',')})&select=*`);
    if (res.ok) subscriptions = await res.json();
  } catch {
    return { sent: 0, removed: 0, failed: 0, total: 0 };
  }

  const payload = { title: message.title, body: message.body || '', url: message.url || '/modules/', requireInteraction: !!message.requireInteraction };
  let sent = 0, removed = 0, failed = 0;

  await Promise.all(subscriptions.map(async (subRow) => {
    try {
      const result = await sendWebPush(env, subRow, payload, { urgency: message.urgency });
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

async function sendApnsToUsers(env, ids, message) {
  if (!env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_AUTH_KEY) return { sent: 0, removed: 0, failed: 0, total: 0 };

  let tokens = [];
  try {
    const res = await sb(env, `/core_apns_device_tokens?auth_user_id=in.(${ids.join(',')})&select=*`);
    if (res.ok) tokens = await res.json();
  } catch {
    return { sent: 0, removed: 0, failed: 0, total: 0 };
  }

  let sent = 0, removed = 0, failed = 0;

  await Promise.all(tokens.map(async (tokenRow) => {
    try {
      let result = await sendApnsPush(env, tokenRow, message);
      // A device built via Xcode (Debug) only ever gets a sandbox token,
      // while the App Store build only ever gets a production one — but the
      // client can't always tell us which for certain, and a token minted
      // under one can flip which build it's tied to between test sessions.
      // Apple returns the same "BadDeviceToken" for a dead token AND for a
      // token sent to the wrong environment, so retry the other host once
      // before concluding it's actually dead; if that's what fixes it,
      // correct the stored environment so the next send doesn't repeat this.
      if (!result.ok && result.reason === 'BadDeviceToken') {
        const altEnvironment = tokenRow.environment === 'production' ? 'sandbox' : 'production';
        const altResult = await sendApnsPush(env, { ...tokenRow, environment: altEnvironment }, message);
        if (altResult.ok) {
          await sb(env, `/core_apns_device_tokens?id=eq.${tokenRow.id}`, 'PATCH', { environment: altEnvironment }).catch(() => {});
        }
        result = altResult;
      }

      if (result.ok) {
        sent++;
      } else if (result.reason === 'BadDeviceToken' || result.reason === 'Unregistered') {
        await sb(env, `/core_apns_device_tokens?id=eq.${tokenRow.id}`, 'DELETE').catch(() => {});
        removed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }));

  return { sent, removed, failed, total: tokens.length };
}

/**
 * Sends a push notification to every device each of `authUserIds` has
 * subscribed on, across both Web Push and native APNs. Best-effort per
 * device: a dead subscription/token is deleted, everything else is just
 * counted. Never throws — callers should treat this as fire-and-forget
 * alongside whatever action triggered it (an evacuation starting, etc).
 */
export async function sendPushToUsers(env, authUserIds, message) {
  const ids = [...new Set((authUserIds || []).filter(Boolean))];
  if (!ids.length) return { sent: 0, removed: 0, failed: 0, total: 0 };

  const [web, apns] = await Promise.all([
    sendWebPushToUsers(env, ids, message),
    sendApnsToUsers(env, ids, message),
  ]);

  return {
    sent: web.sent + apns.sent,
    removed: web.removed + apns.removed,
    failed: web.failed + apns.failed,
    total: web.total + apns.total,
  };
}
