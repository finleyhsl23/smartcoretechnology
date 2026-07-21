/**
 * POST /api/smartfits-engineer-audit/pattern-alert
 *
 * Called by the client right after an audit is submitted. Checks whether
 * any criterion has now scored "Needs action" (3) on 3+ of this engineer's
 * submitted audits, and — for each criterion crossing that threshold for
 * the first time — records it (so it never fires twice for the same issue)
 * and emails everyone configured in Settings with the full detail.
 *
 * Body: { engineer_employee_id, submission_id }
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY in env
 */

const SCHEMA = 'smartfitsinstallationsltd';
const SITE = 'https://smartcoretechnology.co.uk';
const THRESHOLD = 3;
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
    const submissionId = body.submission_id || null;
    if (!engineerEmployeeId) return json({ error: 'engineer_employee_id is required' }, 400, corsHeaders);

    const [engineers, submissions, criteria, settingsRows] = await Promise.all([
      pgGet(env, null, `/core_employees?id=eq.${engineerEmployeeId}&select=id,full_name,job_title&limit=1`),
      pgGet(env, SCHEMA, `/audit_submissions?engineer_employee_id=eq.${engineerEmployeeId}&status=eq.submitted&select=id,created_at`),
      pgGet(env, SCHEMA, `/audit_criteria?select=id,label`),
      pgGet(env, SCHEMA, `/audit_settings?id=eq.${SETTINGS_ID}&select=pattern_alert_emails&limit=1`),
    ]);

    const engineer = engineers?.[0];
    if (!engineer) return json({ error: 'Engineer not found' }, 404, corsHeaders);

    const recipients = (settingsRows?.[0]?.pattern_alert_emails || []).filter(Boolean);
    if (!recipients.length || !submissions.length) {
      return json({ success: true, alerted: [] }, 200, corsHeaders);
    }

    const criteriaById = Object.fromEntries((criteria || []).map(c => [c.id, c]));
    const submissionById = Object.fromEntries(submissions.map(s => [s.id, s]));
    const submissionIds = submissions.map(s => s.id);

    const scores = await pgGet(env, SCHEMA,
      `/audit_submission_scores?submission_id=in.(${submissionIds.join(',')})&score=eq.3&select=submission_id,criterion_id,comment`
    );

    const byCriterion = {};
    for (const s of (scores || [])) {
      (byCriterion[s.criterion_id] ||= []).push(s);
    }

    const existingAlerts = await pgGet(env, SCHEMA,
      `/audit_pattern_alerts?engineer_employee_id=eq.${engineerEmployeeId}&select=criterion_id`
    );
    const alreadyAlerted = new Set((existingAlerts || []).map(a => a.criterion_id));

    const newlyCrossed = [];
    for (const [criterionId, rows] of Object.entries(byCriterion)) {
      if (rows.length < THRESHOLD || alreadyAlerted.has(criterionId)) continue;
      newlyCrossed.push({
        criterionId,
        label: criteriaById[criterionId]?.label || 'Unknown criterion',
        count: rows.length,
        occurrences: rows
          .map(r => ({ date: submissionById[r.submission_id]?.created_at, comment: r.comment }))
          .sort((a, b) => new Date(a.date) - new Date(b.date)),
      });
    }

    if (!newlyCrossed.length) {
      return json({ success: true, alerted: [] }, 200, corsHeaders);
    }

    // Record before sending — a rare duplicate email from a race is far
    // less bad than a send that never gets recorded and re-fires forever.
    for (const c of newlyCrossed) {
      await pgPost(env, SCHEMA, '/audit_pattern_alerts', {
        engineer_employee_id: engineerEmployeeId,
        criterion_id: c.criterionId,
        occurrence_count: c.count,
        triggered_by_submission_id: submissionId,
      }, { 'Prefer': 'return=minimal,resolution=ignore-duplicates' });
    }

    const html = patternAlertHtml({ engineer, issues: newlyCrossed });
    const subject = newlyCrossed.length === 1
      ? `Recurring issue flagged — ${engineer.full_name}`
      : `${newlyCrossed.length} recurring issues flagged — ${engineer.full_name}`;

    await sendEmail(env, { to: recipients, subject, html });

    return json({ success: true, alerted: newlyCrossed.map(c => c.criterionId) }, 200, corsHeaders);
  } catch (err) {
    console.error('pattern-alert error:', err);
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

async function pgPost(env, schema, path, body, extraHeaders = {}) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
    ...extraHeaders,
  };
  if (schema) headers['Content-Profile'] = schema;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) { const t = await res.text(); throw new Error(`DB POST error: ${t}`); }
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
// SmartCore's other transactional emails (see send-employee-invite.js).
// ---------------------------------------------------------------------------
function patternAlertHtml({ engineer, issues }) {
  const profileLink = `${SITE}/custom/smartfitsinstallationsltd/engineer-audit/employee.html?id=${engineer.id}`;
  const issueCount = issues.length;

  const issueBlocks = issues.map(issue => `
    <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:14px;padding:20px 22px;margin-bottom:16px;text-align:left">
      <div style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.3);margin-bottom:12px">${issue.count}&times; Needs Action</div>
      <div style="font-size:15px;font-weight:700;color:#f5f5f7;line-height:1.4;margin-bottom:14px">${esc(issue.label)}</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:12.5px">
        ${issue.occurrences.map(o => `
          <tr>
            <td style="padding:6px 0;border-top:1px solid rgba(255,255,255,.06);color:#8a8a9e;vertical-align:top;white-space:nowrap;width:110px">${esc(fmtDate(o.date))}</td>
            <td style="padding:6px 0;border-top:1px solid rgba(255,255,255,.06);color:#c0c0d4">${esc(o.comment || '—')}</td>
          </tr>`).join('')}
      </table>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recurring issue flagged</title>
</head>
<body style="margin:0;padding:0;background:#06060e;font-family:-apple-system,BlinkMacSystemFont,'Inter',Helvetica,Arial,sans-serif;color:#e0e0ea;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;font-size:0">${esc(engineer.full_name)} has ${issueCount} recurring install issue${issueCount === 1 ? '' : 's'} flagged across their audits.</div>
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
      <div style="display:inline-flex;align-items:center;gap:6px;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:rgba(239,68,68,.15);color:#f87171;border:1px solid rgba(239,68,68,.3);margin-bottom:24px">⚠️ Recurring Issue Flagged</div>

      <h1 style="font-size:26px;font-weight:800;color:#f5f5f7;letter-spacing:-.04em;line-height:1.25;margin:0 0 8px">${esc(engineer.full_name)}</h1>
      <p style="font-size:13px;color:#8a8a9e;margin:0 0 32px">${esc(engineer.job_title || '')}</p>

      <p style="font-size:15px;color:#8a8a9e;line-height:1.75;margin:0 0 32px;text-align:left">
        The same criteri${issueCount === 1 ? 'on has' : 'a have'} now scored <strong style="color:#f87171">Needs Action</strong> on <strong style="color:#c0c0d4">${THRESHOLD} or more</strong> submitted install audits for this engineer. Full detail below.
      </p>

      <div style="text-align:left">
        ${issueBlocks}
      </div>

      <a href="${profileLink}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:15px 36px;border-radius:14px;letter-spacing:-.02em;margin-top:8px">
        View Engineer Profile →
      </a>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 40px;background:#09090f;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#52526e;text-align:center;line-height:2">
      SmartCore Technology &bull; <a href="${SITE}" style="color:#5b8fff;text-decoration:none">smartcoretechnology.co.uk</a><br>
      You're receiving this because your email is listed under Recurring Pattern Alerts in the Engineer Install Audit module's Settings.
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
