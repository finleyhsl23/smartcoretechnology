/**
 * POST /api/smartfits-engineer-audit/low-score-alert
 *
 * Called by the client right after an audit is submitted. If the
 * submission's overall percentage falls below the module's configured fail
 * threshold, emails the engineer's currently-assigned manager(s) (Manage
 * Assignments) with the full detail. Marks the submission so it only ever
 * fires once, even if the client retries.
 *
 * Body: { engineer_employee_id, submission_id }
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY in env
 */

const SCHEMA = 'smartfitsinstallationsltd';
const SITE = 'https://smartcoretechnology.co.uk';
const SETTINGS_ID = '00000000-0000-0000-0000-000000000001';

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  try {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Unauthorised' }, 401, corsHeaders);

    const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_SERVICE_KEY },
    });
    if (!userRes.ok) return json({ error: 'Unauthorised' }, 401, corsHeaders);

    const body = await request.json();
    const engineerEmployeeId = body.engineer_employee_id;
    const submissionId = body.submission_id;
    if (!engineerEmployeeId || !submissionId) return json({ error: 'engineer_employee_id and submission_id are required' }, 400, corsHeaders);

    const [engineers, submissionRows, settingsRows] = await Promise.all([
      pgGet(env, null, `/core_employees?id=eq.${engineerEmployeeId}&select=id,full_name,job_title&limit=1`),
      pgGet(env, SCHEMA, `/audit_submissions?id=eq.${submissionId}&select=id,created_at,low_score_alert_sent_at&limit=1`),
      pgGet(env, SCHEMA, `/audit_settings?id=eq.${SETTINGS_ID}&select=fail_threshold_percent&limit=1`),
    ]);

    const engineer = engineers?.[0];
    const submission = submissionRows?.[0];
    if (!engineer || !submission) return json({ error: 'Not found' }, 404, corsHeaders);
    if (submission.low_score_alert_sent_at) return json({ success: true, sent: false, reason: 'already sent' }, 200, corsHeaders);

    const threshold = settingsRows?.[0]?.fail_threshold_percent ?? 60;

    const scores = await pgGet(env, SCHEMA,
      `/audit_submission_scores?submission_id=eq.${submissionId}&select=score,comment,criterion_id`
    );
    const scored = (scores || []).filter(s => s.score > 0); // N/A doesn't count
    if (!scored.length) return json({ success: true, sent: false, reason: 'nothing scored' }, 200, corsHeaders);

    const avg = scored.reduce((a, s) => a + s.score, 0) / scored.length;
    const pct = Math.round(((3 - avg) / 2) * 100);
    if (pct >= threshold) return json({ success: true, sent: false, reason: 'above threshold' }, 200, corsHeaders);

    const managerAssignments = await pgGet(env, SCHEMA,
      `/audit_manager_assignments?engineer_employee_id=eq.${engineerEmployeeId}&is_active=eq.true&select=manager_employee_id`
    );
    const managerIds = [...new Set((managerAssignments || []).map(a => a.manager_employee_id))];
    if (!managerIds.length) return json({ success: true, sent: false, reason: 'no assigned manager' }, 200, corsHeaders);

    const managers = await pgGet(env, null,
      `/core_employees?id=in.(${managerIds.join(',')})&select=work_email,personal_email`
    );
    const recipients = [...new Set((managers || []).map(m => m.work_email || m.personal_email).filter(Boolean))];
    if (!recipients.length) return json({ success: true, sent: false, reason: 'no manager email on file' }, 200, corsHeaders);

    const needsAction = scored.filter(s => s.score === 3);
    let criteriaById = {};
    if (needsAction.length) {
      const criteria = await pgGet(env, SCHEMA, `/audit_criteria?select=id,label`);
      criteriaById = Object.fromEntries((criteria || []).map(c => [c.id, c]));
    }

    // Mark sent before emailing — a rare duplicate email from a race is far
    // less bad than a send that never gets recorded and re-fires forever.
    await pgPatch(env, SCHEMA, `/audit_submissions?id=eq.${submissionId}`, { low_score_alert_sent_at: new Date().toISOString() });

    const html = lowScoreAlertHtml({
      engineer,
      pct,
      threshold,
      submittedAt: submission.created_at,
      needsAction: needsAction.map(s => ({ label: criteriaById[s.criterion_id]?.label || 'Unknown criterion', comment: s.comment })),
      submissionId,
    });

    await sendEmail(env, { to: recipients, subject: `Audit below fail threshold — ${engineer.full_name} (${pct}%)`, html });

    return json({ success: true, sent: true }, 200, corsHeaders);
  } catch (err) {
    console.error('low-score-alert error:', err);
    return json({ error: err.message || 'Internal error' }, 500, corsHeaders);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function pgGet(env, schema, path) {
  const headers = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  if (schema) headers['Accept-Profile'] = schema;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, { headers });
  if (!res.ok) { const t = await res.text(); throw new Error(`DB GET error: ${t}`); }
  return res.json();
}

async function pgPatch(env, schema, path, body) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  if (schema) headers['Content-Profile'] = schema;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
  if (!res.ok) { const t = await res.text(); throw new Error(`DB PATCH error: ${t}`); }
}

async function sendEmail(env, { to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'SmartCore <noreply@smartcoretechnology.co.uk>', to, subject, html }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('Resend error:', t);
    throw new Error('Failed to send email');
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Email template — matches the dark/navy branded style used across
// SmartCore's other transactional emails (see pattern-alert.js).
// ---------------------------------------------------------------------------
function lowScoreAlertHtml({ engineer, pct, threshold, submittedAt, needsAction, submissionId }) {
  const profileLink = `${SITE}/custom/smartfitsinstallationsltd/engineer-audit/employee.html?id=${engineer.id}`;

  const issueBlocks = needsAction.length ? `
    <div style="text-align:left;margin-top:8px">
      <div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#8a8a9e;margin-bottom:10px">Criteria marked Needs Action</div>
      ${needsAction.map(issue => `
        <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:12px;padding:14px 16px;margin-bottom:10px">
          <div style="font-size:13.5px;font-weight:700;color:#f5f5f7;line-height:1.4">${esc(issue.label)}</div>
          ${issue.comment ? `<div style="font-size:12.5px;color:#c0c0d4;margin-top:4px">${esc(issue.comment)}</div>` : ''}
        </div>`).join('')}
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit below fail threshold</title>
</head>
<body style="margin:0;padding:0;background:#06060e;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#e0e0ea;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;font-size:0">${esc(engineer.full_name)}'s install audit scored ${pct}%, below the ${threshold}% fail threshold.</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06060e;padding:40px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="border-radius:24px;overflow:hidden;border:1px solid rgba(255,255,255,.08);box-shadow:0 32px 80px rgba(0,0,0,.7)">

  <tr>
    <td style="background:linear-gradient(135deg,#0b0b18 0%,#0f1529 60%,#0c1220 100%);padding:32px 40px;border-bottom:1px solid rgba(255,255,255,.07)">
      <table cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:12px;vertical-align:middle">
          <img src="https://smartcoretechnology.co.uk/SmartCore%20Official%20Logos/SC%20Icon%20-%20Black%20Background.png" alt="SmartCore" width="42" height="42" style="display:block;border-radius:12px" />
        </td>
        <td style="vertical-align:middle">
          <div style="font-size:17px;font-weight:800;color:#f5f5f7;letter-spacing:-.03em">SmartCore</div>
          <div style="font-size:10px;color:rgba(255,255,255,.35);letter-spacing:.08em;text-transform:uppercase;margin-top:1px">Engineer Install Audit</div>
        </td>
      </tr></table>
    </td>
  </tr>

  <tr>
    <td style="background:#0e0e18;padding:48px 40px;text-align:center">
      <div style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.3);margin-bottom:24px">⚠️ Audit Below Fail Threshold</div>

      <h1 style="font-size:26px;font-weight:800;color:#f5f5f7;letter-spacing:-.04em;line-height:1.25;margin:0 0 8px">${esc(engineer.full_name)}</h1>
      <p style="font-size:13px;color:#8a8a9e;margin:0 0 24px">${esc(engineer.job_title || '')} &bull; Audited ${esc(fmtDate(submittedAt))}</p>

      <div style="display:inline-block;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:16px;padding:18px 32px;margin-bottom:28px">
        <div style="font-size:36px;font-weight:800;color:#f87171;letter-spacing:-.03em;line-height:1">${pct}%</div>
        <div style="font-size:11.5px;color:#8a8a9e;margin-top:4px">Fail threshold is ${threshold}%</div>
      </div>

      <p style="font-size:15px;color:#8a8a9e;line-height:1.75;margin:0;text-align:left">
        This install audit scored below the fail threshold configured in the Engineer Install Audit module's Settings. You're receiving this because you're set as an Engineering Manager for this engineer on Manage Assignments.
      </p>

      ${issueBlocks}

      <a href="${profileLink}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:15px 36px;border-radius:14px;letter-spacing:-.02em;margin-top:28px">
        View Engineer Profile →
      </a>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 40px;background:#09090f;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#52526e;text-align:center;line-height:2">
      SmartCore Technology &bull; <a href="${SITE}" style="color:#5b8fff;text-decoration:none">smartcoretechnology.co.uk</a>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
