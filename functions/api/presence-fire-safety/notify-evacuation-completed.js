// POST /api/presence-fire-safety/notify-evacuation-completed
// Called right after evacuation.complete() succeeds. Sends the emergency
// evacuation report — nice-to-read summary, a full Not-Safe/Safe name list,
// and the same photo PDF report as an attachment (see
// _evacuation-report-pdf.js) — to the "Emergency Reports" email list
// configured in Settings (up to 10 addresses, presence_fire_safety_settings.
// emergency_report_emails). Best-effort: failures are logged and swallowed
// — the evacuation itself has already been completed before this endpoint
// is ever called, and this notification must never appear to "fail" that.
import { json, options, getCallerProfile, hasPermission, sb } from './_auth.js';
import { sendResendEmail, smartcoreEmailShell } from '../_utils.js';
import { buildEvacuationReportPdf, STATUS_LABEL, fmtDuration } from './_evacuation-report-pdf.js';

export const onRequestOptions = () => options();

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDT(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Email HTML has to hold up in clients that ignore <style>/media queries
// (older Outlook among them), so nothing here depends on either — the
// stat tiles reflow because inline-block boxes wrap on their own at narrow
// widths, and the roll call is a stack of full-width rows rather than a
// <table>, so there are no columns for anything to run off the side of.
function statTile(label, value, color) {
  return `<div style="display:inline-block;width:44%;min-width:120px;margin:1.5% 1.5% 0 0;vertical-align:top;box-sizing:border-box;padding:14px 8px;text-align:center;background:#f8fafc;border-radius:10px">
    <div style="font-size:22px;font-weight:800;color:${color}">${value}</div>
    <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-top:2px">${esc(label)}</div>
  </div>`;
}

function notSafeRow(p) {
  const status = esc(STATUS_LABEL[p.roll_call_status] || p.roll_call_status);
  return `<div style="padding:10px 12px;border-bottom:1px solid #f3f4f6">
    <div style="font-size:13px;font-weight:700">${esc(p.display_name_snapshot)}</div>
    <div style="font-size:11.5px;color:#6b7280;text-transform:capitalize;margin-top:1px">${esc(p.subject_type)}${p.department_snapshot ? ` &middot; ${esc(p.department_snapshot)}` : ''}</div>
    <div style="margin-top:6px">
      <span style="display:inline-block;background:#fee2e2;color:#dc2626;font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px">${status}</span>
    </div>
    ${p.notes ? `<div style="font-size:12px;color:#6b7280;margin-top:6px">${esc(p.notes)}</div>` : ''}
  </div>`;
}

function safeRow(p) {
  return `<div style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px">
    <strong>${esc(p.display_name_snapshot)}</strong>
    <span style="color:#6b7280;text-transform:capitalize"> &mdash; ${esc(p.subject_type)}${p.department_snapshot ? `, ${esc(p.department_snapshot)}` : ''}</span>
  </div>`;
}

function buildReportEmailHtml({ session, siteName, notSafe, safe }) {
  const allSafe = notSafe.length === 0;
  const headerColor = allSafe ? '#16a34a' : '#dc2626';
  const headerBg = allSafe ? '#f0fdf4' : '#fef2f2';
  const headline = allSafe ? 'Everyone is accounted for' : `${notSafe.length} ${notSafe.length === 1 ? 'person is' : 'people are'} not marked safe`;

  const statsRow = `<div style="margin:20px 0;font-size:0">
    ${statTile('Snapshotted', session.snapshot_count ?? 0, '#111827')}
    ${statTile('Safe', session.safe_count ?? 0, '#16a34a')}
    ${statTile('Missing', session.missing_count ?? 0, '#dc2626')}
    ${statTile('Unaccounted', session.unaccounted_count ?? 0, '#d97706')}
  </div>`;

  const notSafeSection = `
    <div style="margin-top:24px;padding:16px;border-radius:12px;background:#fef2f2;border:1px solid #fecaca">
      <h3 style="margin:0 0 4px;font-size:14px;color:#991b1b">Not marked safe (${notSafe.length})</h3>
      ${notSafe.length
        ? `<div style="margin-top:8px;border-top:1px solid #f3f4f6">${notSafe.map(notSafeRow).join('')}</div>`
        : `<p style="margin:8px 0 0;font-size:13px;color:#16a34a;font-weight:600">Nobody — everyone was marked safe.</p>`}
    </div>`;

  const safeSection = `
    <div style="margin-top:16px;padding:16px;border-radius:12px;background:#f0fdf4;border:1px solid #bbf7d0">
      <h3 style="margin:0 0 4px;font-size:14px;color:#166534">Marked safe (${safe.length})</h3>
      ${safe.length
        ? `<div style="margin-top:8px;border-top:1px solid #f3f4f6">${safe.map(safeRow).join('')}</div>`
        : `<p style="margin:8px 0 0;font-size:13px;color:#6b7280">Nobody was marked safe yet.</p>`}
    </div>`;

  return smartcoreEmailShell({
    title: `Evacuation report — ${esc(siteName)}`,
    intro: `The emergency evacuation at <strong>${esc(siteName)}</strong> has been completed.`,
    bodyHtml: `
      <div style="margin:16px 0;padding:14px 16px;border-radius:12px;background:${headerBg};border:1px solid ${headerColor}">
        <strong style="color:${headerColor};font-size:15px">${esc(headline)}</strong>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:12px 0 0">
        <tr><td style="padding:5px 0;font-size:13px;color:#6b7280;width:40%">Started</td><td style="padding:5px 0;font-size:13px">${esc(fmtDT(session.started_at))}</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#6b7280">Completed</td><td style="padding:5px 0;font-size:13px">${esc(fmtDT(session.completed_at))}</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#6b7280">Duration</td><td style="padding:5px 0;font-size:13px">${esc(fmtDuration(session.started_at, session.completed_at || new Date().toISOString()))}</td></tr>
        <tr><td style="padding:5px 0;font-size:13px;color:#6b7280">Assembly point</td><td style="padding:5px 0;font-size:13px">${esc(session.assembly_point || 'Not recorded')}</td></tr>
      </table>
      ${statsRow}
      ${notSafeSection}
      ${safeSection}
      <p style="margin:20px 0 0;font-size:12px;color:#6b7280">A full PDF report with everyone's photo is attached — anyone not marked safe is listed first, followed by everyone marked safe.</p>
    `,
  });
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

    const settingsRes = await sb(env, `/presence_fire_safety_settings?company_id=eq.${profile.company_id}&select=emergency_report_emails`);
    const [settingsRow] = await settingsRes.json();
    const emails = [...new Set((settingsRow?.emergency_report_emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
    if (!emails.length) return json({ success: true, notified: 0, reason: 'No emergency report emails configured' });

    let report;
    try {
      report = await buildEvacuationReportPdf(env, profile.company_id, sessionId);
    } catch (e) {
      return json({ success: false, reason: e.message || 'Evacuation session not found' }, 404);
    }
    const { session, people, bytes: pdfBytes, filename } = report;
    const siteName = session.sites?.name || 'the site';
    const notSafe = people.filter((p) => p.roll_call_status !== 'safe');
    const safe = people.filter((p) => p.roll_call_status === 'safe');

    const html = buildReportEmailHtml({ session, siteName, notSafe, safe });
    const attachments = [{ filename, content: bytesToBase64(pdfBytes), content_type: 'application/pdf' }];

    const results = await Promise.allSettled(
      emails.map((to) => sendResendEmail(env, {
        to, subject: `${notSafe.length === 0 ? 'All safe' : 'Action needed'} — evacuation report, ${siteName}`, html, attachments,
      }))
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
