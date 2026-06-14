/**
 * POST /api/leave-action
 *
 * Approves or rejects a leave request and sends an email notification to the employee.
 *
 * Body: { request_id, action: "approve" | "reject", reason? }
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY in env
 */

const SCHEMA = 'holidaymanagement';

export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type':                 'application/json',
  };

  try {
    // Auth
    const authHeader = request.headers.get('Authorization') || '';
    const token      = authHeader.replace('Bearer ', '').trim();
    if (!token) return json({ error: 'Unauthorised' }, 401, corsHeaders);

    const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey:        env.SUPABASE_SERVICE_KEY,
      },
    });
    if (!userRes.ok) return json({ error: 'Unauthorised' }, 401, corsHeaders);
    const caller = await userRes.json();

    const body = await request.json();
    const { request_id, action, reason } = body;

    if (!request_id) return json({ error: 'request_id is required' }, 400, corsHeaders);
    if (!['approve', 'reject', 'cancel_approval', 'cancel_rejection'].includes(action)) {
      return json({ error: 'action must be approve, reject, cancel_approval, or cancel_rejection' }, 400, corsHeaders);
    }

    // Load leave request with employee details
    const requests = await supabaseGet(env,
      `/${SCHEMA}/leave_requests?id=eq.${request_id}&select=*&limit=1`
    );
    if (!requests?.length) return json({ error: 'Leave request not found' }, 404, corsHeaders);
    const lr = requests[0];

    // Verify caller is admin/owner of this company
    const membership = await supabaseGet(env,
      `/${SCHEMA}/company_users?user_id=eq.${caller.id}&company_id=eq.${lr.company_id}&select=role&limit=1`
    );
    if (!membership?.length || !['admin','owner'].includes(membership[0].role)) {
      return json({ error: 'Forbidden — admin or owner access required' }, 403, corsHeaders);
    }

    // Load employee
    const employees = await supabaseGet(env,
      `/${SCHEMA}/employees?id=eq.${lr.employee_id}&select=*&limit=1`
    );
    const employee = employees?.[0];
    if (!employee) return json({ error: 'Employee not found' }, 404, corsHeaders);

    // Load authoriser employee record
    const authoriserEmps = await supabaseGet(env,
      `/${SCHEMA}/employees?user_id=eq.${caller.id}&company_id=eq.${lr.company_id}&select=first_name,last_name&limit=1`
    );
    const authoriserName = authoriserEmps?.[0]
      ? `${authoriserEmps[0].first_name} ${authoriserEmps[0].last_name}`
      : caller.email;

    // Load company
    const companies = await supabaseGet(env,
      `/${SCHEMA}/companies?id=eq.${lr.company_id}&select=*&limit=1`
    );
    const company = companies?.[0];
    const companyName = company?.display_name || company?.company_name || 'Your Company';

    // Determine new status
    let newStatus;
    if (action === 'approve')            newStatus = 'approved';
    else if (action === 'reject')        newStatus = 'rejected';
    else if (action === 'cancel_approval' || action === 'cancel_rejection') newStatus = 'pending';

    // Update leave request
    const updatePayload = {
      status:          newStatus,
      actioned_by:     caller.id,
      actioned_at:     new Date().toISOString(),
      rejection_reason: action === 'reject' ? (reason || null) : null,
      updated_at:      new Date().toISOString(),
    };
    await supabasePatch(env, `/${SCHEMA}/leave_requests?id=eq.${request_id}`, updatePayload);

    // Recalculate leave balance if approving or cancelling approval
    if (action === 'approve' || action === 'cancel_approval') {
      await recalcBalance(env, lr.employee_id, lr.company_id, new Date(lr.start_date).getFullYear());
    }

    // Send email notification (not for cancel actions unless employee has email)
    let emailSent = false;
    if (employee.email && (action === 'approve' || action === 'reject')) {
      const emailData = {
        employeeName: `${employee.first_name} ${employee.last_name}`,
        companyName,
        authoriserName,
        action,
        reason:        reason || null,
        startDate:     lr.start_date,
        endDate:       lr.end_date,
        days:          lr.total_days,
        leaveType:     lr.leave_type || 'Annual Leave',
        dashboardLink: 'https://smartcoretechnology.co.uk/systems/holidaymanagement/app/my-leave.html',
      };

      await sendEmail(env, {
        to:      employee.email,
        subject: action === 'approve'
          ? `Your leave request has been approved — ${formatDateRange(lr.start_date, lr.end_date)}`
          : `Your leave request has been declined — ${formatDateRange(lr.start_date, lr.end_date)}`,
        html: leaveActionHtml(emailData),
      });
      emailSent = true;
    }

    // Audit log
    await supabasePost(env, `/${SCHEMA}/audit_log`, {
      company_id:          lr.company_id,
      action:              `leave_${action}d`,
      performed_by:        caller.id,
      performed_by_email:  caller.email,
      details:             { request_id, employee_id: lr.employee_id, reason: reason || null },
      created_at:          new Date().toISOString(),
    });

    return json({ success: true, status: newStatus, email_sent: emailSent }, 200, corsHeaders);

  } catch (err) {
    console.error('leave-action error:', err);
    return json({ error: err.message || 'Internal error' }, 500, corsHeaders);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// ---------------------------------------------------------------------------
// Balance recalculation
// ---------------------------------------------------------------------------
async function recalcBalance(env, employeeId, companyId, year) {
  try {
    // Load employee for allowance
    const emps = await supabaseGet(env, `/${SCHEMA}/employees?id=eq.${employeeId}&select=annual_leave_allowance,start_date&limit=1`);
    const emp  = emps?.[0];
    if (!emp) return;

    // Sum approved leave days for this year
    const startOfYear = `${year}-01-01`;
    const endOfYear   = `${year}-12-31`;
    const approved = await supabaseGet(env,
      `/${SCHEMA}/leave_requests?employee_id=eq.${employeeId}&company_id=eq.${companyId}&status=eq.approved&start_date=gte.${startOfYear}&start_date=lte.${endOfYear}&select=total_days`
    );
    const usedDays = (approved || []).reduce((sum, r) => sum + (parseFloat(r.total_days) || 0), 0);

    const allowance  = parseFloat(emp.annual_leave_allowance) || 0;
    const remaining  = Math.max(0, allowance - usedDays);

    // Upsert balance
    const balanceRows = await supabaseGet(env,
      `/${SCHEMA}/leave_balances?employee_id=eq.${employeeId}&year=eq.${year}&select=id&limit=1`
    );

    if (balanceRows?.length) {
      await supabasePatch(env,
        `/${SCHEMA}/leave_balances?employee_id=eq.${employeeId}&year=eq.${year}`,
        { days_taken: usedDays, days_remaining: remaining, updated_at: new Date().toISOString() }
      );
    } else {
      await supabasePost(env, `/${SCHEMA}/leave_balances`, {
        employee_id:    employeeId,
        company_id:     companyId,
        year,
        allowance,
        days_taken:     usedDays,
        days_remaining: remaining,
        created_at:     new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      });
    }
  } catch (e) {
    // Non-fatal — balance can be recalculated later
    console.error('Balance recalc failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function supabaseGet(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey:           env.SUPABASE_SERVICE_KEY,
      Authorization:    `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Accept-Profile': SCHEMA,
    },
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`DB GET error: ${t}`); }
  return res.json();
}

async function supabasePost(env, path, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method:  'POST',
    headers: {
      apikey:           env.SUPABASE_SERVICE_KEY,
      Authorization:    `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Profile': SCHEMA,
      'Content-Type':   'application/json',
      Prefer:           'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`DB POST error: ${t}`); }
}

async function supabasePatch(env, path, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
    method:  'PATCH',
    headers: {
      apikey:           env.SUPABASE_SERVICE_KEY,
      Authorization:    `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Profile': SCHEMA,
      'Content-Type':   'application/json',
      Prefer:           'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`DB PATCH error: ${t}`); }
}

async function sendEmail(env, { to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'SmartCore <noreply@smartcoretechnology.co.uk>',
      to:      [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('Resend error:', t);
    throw new Error('Failed to send email');
  }
}

function formatDateRange(start, end) {
  const opts = { day: 'numeric', month: 'short', year: 'numeric' };
  const s = new Date(start).toLocaleDateString('en-GB', opts);
  const e = new Date(end).toLocaleDateString('en-GB', opts);
  return s === e ? s : `${s} – ${e}`;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// ---------------------------------------------------------------------------
// Email template
// ---------------------------------------------------------------------------
function leaveActionHtml({ employeeName, companyName, authoriserName, action, reason, startDate, endDate, days, leaveType, dashboardLink }) {
  const approved   = action === 'approve';
  const accentCol  = approved ? '#22c55e' : '#ef4444';
  const accentBg   = approved ? '#f0fdf4' : '#fef2f2';
  const icon       = approved
    ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="#22c55e" width="32" height="32"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="#ef4444" width="32" height="32"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>';
  const statusWord = approved ? 'Approved' : 'Declined';
  const daysLabel  = days === 1 ? '1 day' : `${days} days`;
  const dateRange  = formatDateRange(startDate, endDate);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#0f172a}
  .wrap{max-width:540px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.07)}
  .header{background:#080d1a;padding:24px 32px;display:flex;align-items:center;gap:12px}
  .header-logo{background:#3b82f6;width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center}
  .header-text{color:#fff;font-size:15px;font-weight:700}
  .body{padding:32px}
  .status-banner{background:${accentBg};border:1px solid ${accentCol}33;border-radius:10px;padding:18px 20px;display:flex;align-items:center;gap:14px;margin-bottom:24px}
  .status-text{font-size:17px;font-weight:800;color:${accentCol}}
  .status-sub{font-size:13px;color:#64748b;margin-top:2px}
  h2{font-size:16px;font-weight:800;margin:0 0 14px;color:#0f172a}
  .detail-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
  .detail-label{color:#64748b;font-weight:500}
  .detail-val{color:#0f172a;font-weight:600;text-align:right}
  .reason-box{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:14px 16px;margin:20px 0;font-size:13px;color:#92400e}
  .reason-title{font-weight:700;margin-bottom:4px}
  .btn{display:inline-block;background:#3b82f6;color:#fff!important;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;margin:20px 0 8px}
  .footer{padding:20px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="header-logo">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="#fff" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
    </div>
    <div class="header-text">SmartCore Holiday Management</div>
  </div>
  <div class="body">
    <div class="status-banner">
      ${icon}
      <div>
        <div class="status-text">Leave Request ${statusWord}</div>
        <div class="status-sub">${companyName}</div>
      </div>
    </div>

    <p style="font-size:14px;line-height:1.7;color:#334155;margin:0 0 20px">Hi ${employeeName}, your leave request has been <strong>${statusWord.toLowerCase()}</strong> by ${authoriserName}.</p>

    <h2>Request Details</h2>
    <div class="detail-row"><span class="detail-label">Leave Type</span><span class="detail-val">${leaveType}</span></div>
    <div class="detail-row"><span class="detail-label">Dates</span><span class="detail-val">${dateRange}</span></div>
    <div class="detail-row"><span class="detail-label">Duration</span><span class="detail-val">${daysLabel}</span></div>
    <div class="detail-row"><span class="detail-label">Authorised By</span><span class="detail-val">${authoriserName}</span></div>
    <div class="detail-row" style="border-bottom:none"><span class="detail-label">Decision Date</span><span class="detail-val">${formatDate(new Date().toISOString())}</span></div>

    ${!approved && reason ? `
    <div class="reason-box">
      <div class="reason-title">Reason for declining:</div>
      <div>${reason}</div>
    </div>` : ''}

    ${!approved ? '<p style="font-size:13px;color:#64748b;margin:16px 0">If you have questions about this decision, please speak to your manager or HR team.</p>' : ''}

    <a href="${dashboardLink}" class="btn">View My Leave</a>
  </div>
  <div class="footer">SmartCore Technology &bull; <a href="https://smartcoretechnology.co.uk" style="color:#3b82f6">smartcoretechnology.co.uk</a></div>
</div>
</body>
</html>`;
}
