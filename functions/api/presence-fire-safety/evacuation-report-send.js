// POST /api/presence-fire-safety/evacuation-report-send
// Sends the same evacuation report email/PDF that notify-evacuation-
// completed.js sends to the configured Emergency Reports list, to a small
// set of ad-hoc addresses instead — the "Send to more" option in the
// report viewer right after completing an evacuation, for anyone who
// needs a copy but isn't on that list.
import { json, options, getCallerProfile, hasPermission, sb } from './_auth.js';
import { sendResendEmail } from '../_utils.js';
import { buildEvacuationReportPdf } from './_evacuation-report-pdf.js';
import { buildReportEmailHtml, bytesToBase64 } from './notify-evacuation-completed.js';

export const onRequestOptions = () => options();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EXTRA_EMAILS = 5;

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

    const emails = [...new Set((Array.isArray(body.emails) ? body.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) return json({ error: 'At least one email address is required' }, 400);
    if (emails.length > MAX_EXTRA_EMAILS) return json({ error: `Up to ${MAX_EXTRA_EMAILS} email addresses at a time` }, 400);
    const invalid = emails.filter((e) => !EMAIL_RE.test(e));
    if (invalid.length) return json({ error: `Not a valid email address: ${invalid[0]}` }, 400);

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
      console.error('evacuation-report-send: some emails failed', failures.map((f) => f.reason?.message));
    }

    return json({ success: true, sent: emails.length - failures.length, failed: failures.length });
  } catch (e) {
    console.error('evacuation-report-send:', e.message);
    return json({ success: false, reason: e.message || 'Unexpected error' }, 500);
  }
}
