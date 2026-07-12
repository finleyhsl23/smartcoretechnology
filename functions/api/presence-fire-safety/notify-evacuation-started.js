// POST /api/presence-fire-safety/notify-evacuation-started
// Called right after evacuation.start() succeeds. Server-side because it
// talks to Resend and needs to fan out to a company-wide recipient list
// (owners/admins plus anyone holding an explicit evacuation.* permission
// grant) that a browser session should not need to enumerate itself. Email
// failures are logged and swallowed — an evacuation is already underway and
// this notification must never appear to "fail" the evacuation flow.
import { json, options, getCallerProfile, hasPermission, sb } from './_auth.js';
import { sendResendEmail, smartcoreEmailShell } from '../_utils.js';

export const onRequestOptions = () => options();

export async function onRequestPost({ request, env }) {
  let profile;
  try {
    profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorized' }, 401);
  } catch (e) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const allowed = await hasPermission(env, profile.token, profile.company_id, 'evacuation.start');
    if (!allowed) return json({ error: 'Missing permission: evacuation.start' }, 403);

    const body = await request.json().catch(() => ({}));
    const sessionId = body.evacuation_session_id;
    if (!sessionId) return json({ error: 'evacuation_session_id is required' }, 400);

    const sessionRes = await sb(
      env,
      `/presence_fire_safety_evacuation_sessions?id=eq.${sessionId}&company_id=eq.${profile.company_id}` +
        `&select=id,assembly_point,started_at,site_id,sites(name)`
    );
    const [session] = await sessionRes.json();
    if (!session) return json({ success: false, reason: 'Evacuation session not found' }, 404);

    // Recipients: owners/admins/administrators, plus anyone with an explicit
    // evacuation.* permission grant (e.g. a designated Fire Marshal who
    // isn't an admin).
    const [adminsRes, grantsRes] = await Promise.all([
      sb(env, `/core_employees?company_id=eq.${profile.company_id}&role=in.(owner,admin,administrator)&select=id,full_name,work_email`),
      sb(env, `/presence_fire_safety_permission_grants?company_id=eq.${profile.company_id}&permission=like.evacuation.*&select=employee_id`),
    ]);
    const admins = await adminsRes.json();
    const grants = await grantsRes.json();

    const grantedIds = [...new Set((grants || []).map((g) => g.employee_id))].filter(Boolean);
    let grantedEmployees = [];
    if (grantedIds.length) {
      const idsRes = await sb(
        env,
        `/core_employees?id=in.(${grantedIds.join(',')})&select=id,full_name,work_email`
      );
      grantedEmployees = await idsRes.json();
    }

    const byId = new Map();
    for (const e of [...(admins || []), ...grantedEmployees]) {
      if (e?.id) byId.set(e.id, e);
    }
    const recipients = [...byId.values()].filter((e) => e.work_email);

    const siteName = session.sites?.name || 'your site';
    const html = smartcoreEmailShell({
      title: `Evacuation started at ${siteName}`,
      intro: `An evacuation has been started at ${siteName}. Please proceed to the assembly point immediately.`,
      bodyHtml: `
        <p><strong>Assembly point:</strong> ${session.assembly_point || 'See site evacuation plan'}</p>
        <p><strong>Started at:</strong> ${session.started_at}</p>
      `,
    });

    const results = await Promise.allSettled(
      recipients.map((r) => sendResendEmail(env, { to: r.work_email, subject: `Evacuation started at ${siteName}`, html }))
    );
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length) {
      console.error('notify-evacuation-started: some emails failed', failures.map((f) => f.reason?.message));
    }

    return json({ success: true, notified: recipients.length, failed: failures.length });
  } catch (e) {
    console.error('notify-evacuation-started:', e.message);
    // Still respond 200-shaped success:false — the evacuation itself already
    // succeeded before this endpoint was ever called.
    return json({ success: false, reason: e.message || 'Unexpected error' });
  }
}
