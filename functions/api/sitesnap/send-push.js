// POST /api/sitesnap/send-push { employeeId, companyId, title, body, url }
// Delivers a Web Push notification to every device the target employee has
// subscribed on. Client-triggered right after the action that warrants it
// (e.g. assigning a task) — this project has no server-side trigger
// mechanism for outbound HTTP (no pg_net), matching the pattern already
// used by webhook-notify.js. Requires VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
// to be configured as environment variables (see functions/api/sitesnap/_webpush.js).
import { json, options, getCallerProfile, sb, sbGet } from './_auth.js';
import { sendWebPush } from './_webpush.js';

export async function onRequestOptions() { return options(); }

export async function onRequestPost({ request, env }) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return json({ error: 'Push is not configured on this deployment (missing VAPID keys).' }, 501);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { employeeId, companyId, title, body: messageBody, url } = body || {};
  if (!employeeId || !companyId || !title) return json({ error: 'employeeId, companyId and title are required' }, 400);

  const caller = await getCallerProfile(request, env);
  if (!caller) return json({ error: 'Unauthorized' }, 401);
  // Only members of the same company can trigger a push to one of its
  // employees — this is a company-internal notification, not a public API.
  if (caller.company_id !== companyId) return json({ error: 'Forbidden' }, 403);

  let subscriptions;
  try {
    subscriptions = await sbGet(env, `/sitesnap_push_subscriptions?employee_id=eq.${employeeId}&select=*`);
  } catch {
    return json({ error: 'Could not look up subscriptions' }, 500);
  }

  const payload = { title, body: messageBody || '', url: url || '/systems/sitesnap/index.html' };
  let sent = 0, removed = 0, failed = 0;

  await Promise.all(subscriptions.map(async (sub) => {
    try {
      const result = await sendWebPush(env, sub, payload);
      if (result.ok) {
        sent++;
      } else if (result.status === 404 || result.status === 410) {
        // Subscription is gone (unsubscribed / expired) — self-clean.
        await sb(env, `/sitesnap_push_subscriptions?id=eq.${sub.id}`, 'DELETE').catch(() => {});
        removed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }));

  return json({ sent, removed, failed, total: subscriptions.length });
}
