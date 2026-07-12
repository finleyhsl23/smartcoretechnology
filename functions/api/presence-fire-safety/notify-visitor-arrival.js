// POST /api/presence-fire-safety/notify-visitor-arrival
// Called by systems/presence-fire-safety/shared/api.js right after
// visitors.createVisit() succeeds, when a host_employee_id was set. This has
// to be a server-side endpoint because it talks to Resend — supabase-js in
// the browser has no email-sending capability. A visitor sign-in must never
// fail because a notification email failed, so every error here is caught
// and logged, never thrown back as a hard failure of the sign-in flow.
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
    const allowed = await hasPermission(env, profile.token, profile.company_id, 'presence.manage_visitors');
    if (!allowed) return json({ error: 'Missing permission: presence.manage_visitors' }, 403);

    const body = await request.json().catch(() => ({}));
    const visitorVisitId = body.visitor_visit_id;
    if (!visitorVisitId) return json({ error: 'visitor_visit_id is required' }, 400);

    // Scoped to the caller's own company even though we use the service-role
    // key here — permission was already independently verified above via the
    // caller's own forwarded JWT.
    const visitRes = await sb(
      env,
      `/presence_fire_safety_visitor_visits?id=eq.${visitorVisitId}&company_id=eq.${profile.company_id}` +
        `&select=id,host_employee_id,visit_reason,site_id,sites(name),presence_fire_safety_visitors(first_name,last_name,organisation)`
    );
    const [visit] = await visitRes.json();
    if (!visit) return json({ success: false, reason: 'Visit not found' }, 404);

    if (!visit.host_employee_id) {
      return json({ success: true, skipped: true, reason: 'No host set for this visit' });
    }

    const hostRes = await sb(
      env,
      `/core_employees?id=eq.${visit.host_employee_id}&company_id=eq.${profile.company_id}&select=id,full_name,work_email&limit=1`
    );
    const [host] = await hostRes.json();
    if (!host?.work_email) {
      return json({ success: true, skipped: true, reason: 'Host has no work email on file' });
    }

    const visitor = visit.presence_fire_safety_visitors || {};
    const visitorName = [visitor.first_name, visitor.last_name].filter(Boolean).join(' ') || 'A visitor';

    const html = smartcoreEmailShell({
      title: 'Your visitor has arrived',
      intro: `${visitorName}${visitor.organisation ? ` (${visitor.organisation})` : ''} has signed in at ${visit.sites?.name || 'your site'} to see you.`,
      bodyHtml: visit.visit_reason ? `<p><strong>Reason for visit:</strong> ${visit.visit_reason}</p>` : '',
    });

    try {
      await sendResendEmail(env, {
        to: host.work_email,
        subject: 'Your visitor has arrived',
        html,
      });
      return json({ success: true, notified: host.work_email });
    } catch (emailError) {
      // Fail silently: log only, never throw. The visitor is already signed in.
      console.error('notify-visitor-arrival: email send failed', emailError.message);
      return json({ success: false, reason: 'Email delivery failed' });
    }
  } catch (e) {
    console.error('notify-visitor-arrival:', e.message);
    // Still respond 200 — this is a best-effort notification, not a
    // transactional step in the sign-in flow.
    return json({ success: false, reason: e.message || 'Unexpected error' });
  }
}
