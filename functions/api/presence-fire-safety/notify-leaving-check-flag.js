// POST /api/presence-fire-safety/notify-leaving-check-flag
// Called right after the client flags one or more people as not signed out
// via presence_fire_safety_flag_not_signed_out() (see shared/api.js
// leavingCheck.flagNotSignedOut). Sends one summary email — not one per
// person — to the query address(es) configured in Settings.
//
// Doesn't trust the client's word for who got flagged: it re-reads the
// flag rows the RPC just inserted (scoped to this caller, this company,
// and the last few minutes) and builds the email from those, so this
// endpoint can only ever report flags that were actually recorded through
// the permission-gated RPC — never arbitrary names a compromised or buggy
// client happened to send.
import { json, options, getCallerProfile, sb } from './_auth.js';
import { sendResendEmail, smartcoreEmailShell } from '../_utils.js';

export const onRequestOptions = () => options();

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    const body = await request.json().catch(() => ({}));
    const siteId = body.site_id;
    if (!siteId) return json({ error: 'site_id is required' }, 400);

    const flagsRes = await sb(env, `/presence_fire_safety_leaving_flags?company_id=eq.${profile.company_id}` +
      `&site_id=eq.${siteId}&flagged_by_employee_id=eq.${profile.id}` +
      `&flagged_at=gte.${new Date(Date.now() - 5 * 60 * 1000).toISOString()}` +
      `&select=flagged_at,flagged:core_employees!flagged_employee_id(full_name,job_title),` +
      `flagged_by:core_employees!flagged_by_employee_id(full_name)&order=flagged_at.desc`);
    const flags = (await flagsRes.json()) || [];
    if (!flags.length) return json({ success: true, notified: 0, reason: 'No recent flags found for this caller' });

    const settingsRes = await sb(env, `/presence_fire_safety_settings?company_id=eq.${profile.company_id}&select=leaving_check_query_emails`);
    const [settingsRow] = await settingsRes.json();
    const emails = [...new Set((settingsRow?.leaving_check_query_emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
    if (!emails.length) return json({ success: true, notified: 0, reason: 'No query emails configured' });

    const siteRes = await sb(env, `/sites?id=eq.${siteId}&select=name`);
    const [site] = await siteRes.json();
    const flaggedByName = flags[0]?.flagged_by?.full_name || 'A member of staff';

    const rows = flags.map((f) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600">${esc(f.flagged?.full_name || 'Unknown')}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280">${esc(f.flagged?.job_title || '—')}</td>
      </tr>`).join('');

    const html = smartcoreEmailShell({
      title: `Not signed out — ${esc(site?.name || 'site')}`,
      intro: `<strong>${esc(flaggedByName)}</strong> ran a Leaving Check at <strong>${esc(site?.name || 'the site')}</strong> and flagged ${flags.length} ${flags.length === 1 ? 'person' : 'people'} who the register still shows as signed in.`,
      bodyHtml: `
        <table style="width:100%;border-collapse:collapse;margin-top:8px">
          <thead><tr>
            <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e5e7eb;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#6b7280">Name</th>
            <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e5e7eb;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#6b7280">Job title</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin:20px 0 0;font-size:12px;color:#6b7280">Flagged by ${esc(flaggedByName)} — check whether they've actually left, or if this is a sign-out that was missed.</p>
      `,
    });

    const results = await Promise.allSettled(emails.map((to) => sendResendEmail(env, {
      to, subject: `${flags.length} ${flags.length === 1 ? 'person hasn\'t' : 'people haven\'t'} clocked out — ${site?.name || 'site'}`, html,
    })));
    const failures = results.filter((r) => r.status === 'rejected');

    return json({ success: true, notified: emails.length - failures.length, failed: failures.length, flagged: flags.length });
  } catch (e) {
    console.error('notify-leaving-check-flag:', e.message);
    return json({ success: false, reason: e.message || 'Unexpected error' }, 500);
  }
}
