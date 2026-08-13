// POST /api/presence-fire-safety/notify-evacuation-completed
// Called right after evacuation.complete() succeeds. Sends the emergency
// evacuation report to the "Emergency Reports" email list configured in
// Settings (up to 10 addresses, presence_fire_safety_settings.
// emergency_report_emails) — server-side because it needs the full roll
// call for the just-closed session, not just what the caller's browser
// happens to still have in memory. Best-effort: failures are logged and
// swallowed, matching notify-evacuation-started.js — the evacuation itself
// has already been completed before this endpoint is ever called, and this
// notification must never appear to "fail" that.
import { json, options, getCallerProfile, hasPermission, sb } from './_auth.js';
import { sendResendEmail, smartcoreEmailShell } from '../_utils.js';

export const onRequestOptions = () => options();

const STATUS_LABEL = {
  unaccounted: 'Unaccounted', safe: 'Safe', missing: 'Missing',
  left_before_roll_call: 'Left before roll call', not_expected: 'Not expected', other: 'Other',
};

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDuration(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export async function onRequestPost({ request, env }) {
  let profile;
  try {
    profile = await getCallerProfile(request, env);
    if (!profile) return json({ error: 'Unauthorized' }, 401);
  } catch (e) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const allowed = await hasPermission(env, profile.token, profile.company_id, 'evacuation.complete');
    if (!allowed) return json({ error: 'Missing permission: evacuation.complete' }, 403);

    const body = await request.json().catch(() => ({}));
    const sessionId = body.evacuation_session_id;
    if (!sessionId) return json({ error: 'evacuation_session_id is required' }, 400);

    const [settingsRes, sessionRes] = await Promise.all([
      sb(env, `/presence_fire_safety_settings?company_id=eq.${profile.company_id}&select=emergency_report_emails`),
      sb(
        env,
        `/presence_fire_safety_evacuation_sessions?id=eq.${sessionId}&company_id=eq.${profile.company_id}` +
          `&select=id,started_at,completed_at,assembly_point,snapshot_count,safe_count,missing_count,unaccounted_count,site_id,sites(name)`
      ),
    ]);
    const [settingsRow] = await settingsRes.json();
    const emails = [...new Set((settingsRow?.emergency_report_emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
    if (!emails.length) return json({ success: true, notified: 0, reason: 'No emergency report emails configured' });

    const [session] = await sessionRes.json();
    if (!session) return json({ success: false, reason: 'Evacuation session not found' }, 404);

    const peopleRes = await sb(
      env,
      `/presence_fire_safety_evacuation_people?evacuation_session_id=eq.${sessionId}` +
        `&select=display_name_snapshot,subject_type,department_snapshot,roll_call_status,notes&order=display_name_snapshot`
    );
    const people = await peopleRes.json();
    const outstanding = (people || []).filter((p) => p.roll_call_status !== 'safe');

    const siteName = session.sites?.name || 'the site';
    const otherCount = Math.max(0, (session.snapshot_count || 0) - (session.safe_count || 0) - (session.missing_count || 0) - (session.unaccounted_count || 0));

    const outstandingRows = outstanding.length
      ? `<table style="width:100%;border-collapse:collapse;margin-top:8px">
          <thead><tr>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">Name</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">Type</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">Department</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">Status</th>
            <th style="text-align:left;padding:8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280">Notes</th>
          </tr></thead>
          <tbody>
            ${outstanding.map((p) => `<tr>
              <td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:13px">${esc(p.display_name_snapshot)}</td>
              <td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:13px">${esc(p.subject_type)}</td>
              <td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:13px">${esc(p.department_snapshot || '—')}</td>
              <td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:bold">${esc(STATUS_LABEL[p.roll_call_status] || p.roll_call_status)}</td>
              <td style="padding:8px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280">${esc(p.notes || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>`
      : `<p style="font-size:14px;color:#16a34a;font-weight:bold">Everyone was accounted for as Safe.</p>`;

    const html = smartcoreEmailShell({
      title: `Evacuation report — ${siteName}`,
      intro: `The emergency evacuation at <strong>${esc(siteName)}</strong> has been completed. Summary below.`,
      bodyHtml: `
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:6px 0;font-size:14px;color:#6b7280;width:40%">Started</td><td style="padding:6px 0;font-size:14px">${esc(session.started_at)}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#6b7280">Completed</td><td style="padding:6px 0;font-size:14px">${esc(session.completed_at || new Date().toISOString())}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#6b7280">Duration</td><td style="padding:6px 0;font-size:14px">${fmtDuration(session.started_at, session.completed_at || new Date().toISOString())}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#6b7280">Assembly point</td><td style="padding:6px 0;font-size:14px">${esc(session.assembly_point || 'Not recorded')}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#6b7280">Total snapshotted</td><td style="padding:6px 0;font-size:14px">${session.snapshot_count ?? '—'}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#6b7280">Safe</td><td style="padding:6px 0;font-size:14px;color:#16a34a;font-weight:bold">${session.safe_count ?? 0}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#6b7280">Missing</td><td style="padding:6px 0;font-size:14px;color:#dc2626;font-weight:bold">${session.missing_count ?? 0}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#6b7280">Unaccounted</td><td style="padding:6px 0;font-size:14px;color:#d97706;font-weight:bold">${session.unaccounted_count ?? 0}</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#6b7280">Other / not expected</td><td style="padding:6px 0;font-size:14px">${otherCount}</td></tr>
        </table>
        <h3 style="font-size:15px;margin:24px 0 4px">Not marked Safe</h3>
        ${outstandingRows}
      `,
    });

    const results = await Promise.allSettled(
      emails.map((to) => sendResendEmail(env, { to, subject: `Evacuation report — ${siteName}`, html }))
    );
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length) {
      console.error('notify-evacuation-completed: some emails failed', failures.map((f) => f.reason?.message));
    }

    return json({ success: true, notified: emails.length - failures.length, failed: failures.length });
  } catch (e) {
    console.error('notify-evacuation-completed:', e.message);
    return json({ success: false, reason: e.message || 'Unexpected error' });
  }
}
