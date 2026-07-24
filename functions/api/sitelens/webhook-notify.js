// POST /api/sitelens/webhook-notify { companyId, eventType, payload }
// Fans an event out to the company's active outbound webhooks. Called by the
// client right after a successful action (media upload, checklist/task
// completion) — this project has no pg_net/http extension wired up anywhere,
// so webhook delivery is client-triggered rather than a DB trigger, matching
// the notify-visitor-arrival.js / notify-evacuation-started.js pattern in
// Presence & Fire Safety. Best-effort: failures never block the caller's
// own action, which has already succeeded by the time this runs.
import { json, options, getCallerProfile, sbGet, sbPatch } from './_auth.js';

export async function onRequestOptions() { return options(); }

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { companyId, eventType, payload } = body || {};
  if (!companyId || !eventType) return json({ error: 'companyId and eventType are required' }, 400);

  const caller = await getCallerProfile(request, env);
  if (!caller || caller.company_id !== companyId) return json({ error: 'Unauthorized' }, 401);

  let hooks;
  try {
    hooks = await sbGet(env, `/sitelens_webhooks?company_id=eq.${companyId}&is_active=eq.true&event_types=cs.{${eventType}}&select=*`);
  } catch {
    return json({ delivered: 0 });
  }

  let delivered = 0;
  for (const hook of hooks) {
    const bodyText = JSON.stringify({ event: eventType, companyId, occurredAt: new Date().toISOString(), data: payload || {} });
    let status = 'error';
    try {
      const signature = await hmacHex(hook.secret, bodyText);
      const res = await fetch(hook.target_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SiteLens-Signature': signature, 'X-SiteLens-Event': eventType },
        body: bodyText,
      });
      status = res.ok ? 'ok' : `http_${res.status}`;
      if (res.ok) delivered++;
    } catch {
      status = 'unreachable';
    }
    await sbPatch(env, `/sitelens_webhooks?id=eq.${hook.id}`, { last_fired_at: new Date().toISOString(), last_status: status }).catch(() => {});
  }

  return json({ delivered, total: hooks.length });
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}
