// GET /api/presence-fire-safety/cron-auto-sign-out
// Enforces the "Automatically sign everyone out at a fixed time" Module
// Setting — driven by the cron worker on a frequent schedule (every 15
// minutes, see cron-worker/worker.js), not once a day, since the
// configured time is per-site and can be any time at all. All the actual
// decision-making (is it enabled, is it due yet in this site's own
// timezone, has it already run today) happens server-side in
// presence_fire_safety_run_auto_sign_out() — this endpoint just calls it
// for every active site and reports what happened.
import { json, options, sb } from './_auth.js';

export const onRequestOptions = () => options();

function cronAuth(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('x-cron-token');
  return !!env.CRON_SECRET && token === env.CRON_SECRET;
}

export async function onRequestGet({ request, env }) {
  if (!cronAuth(request, env)) return json({ error: 'Unauthorized' }, 401);

  try {
    const sitesRes = await sb(env, '/sites?is_active=eq.true&select=id');
    const sites = await sitesRes.json();
    if (!sites?.length) return json({ ran: 0, skipped: 0, reason: 'No active sites' });

    const results = [];
    for (const site of sites) {
      const rpcRes = await sb(env, '/rpc/presence_fire_safety_run_auto_sign_out', 'POST', { p_site_id: site.id });
      if (!rpcRes.ok) {
        results.push({ siteId: site.id, ok: false, error: (await rpcRes.text()) || 'RPC failed' });
        continue;
      }
      const result = await rpcRes.json();
      // -2 = not enabled or not due yet — the overwhelming common case on
      // every 15-minute tick, so it's counted but not itemised in results.
      if (result === -2) continue;
      results.push({ siteId: site.id, ok: true, result: result === -1 ? 'already_ran_today' : `signed_out_${result}` });
    }

    return json({ checked: sites.length, ran: results.length, results });
  } catch (e) {
    console.error('cron-auto-sign-out:', e.message);
    return json({ error: e.message || 'Unexpected error' }, 500);
  }
}
