import { createClient } from '@supabase/supabase-js';

const SCHEMA = 'holidaymanagement';

export async function onRequestPost({ request, env }) {
  const SUPABASE_URL = env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
  const RESEND_API_KEY = env.RESEND_API_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !RESEND_API_KEY) {
    return new Response('Missing environment variables', { status: 500 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { action, request: leaveRequest, decision, note, employee_name, company_name, reason } = body;

  if (!action || !leaveRequest) {
    return new Response('action and request are required', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const db = supabase.schema(SCHEMA);

  // Get employee email
  const { data: employee } = await db
    .from('employees')
    .select('email, full_name')
    .eq('id', leaveRequest.employee_id)
    .single();

  if (!employee?.email) {
    return Response.json({ success: false, reason: 'No employee email' });
  }

  // Get admins/owners to notify on new requests
  let adminEmails = [];
  if (action === 'new_request' || action === 'cancel_request') {
    const { data: admins } = await db
      .from('employees')
      .select('email')
      .eq('company_id', leaveRequest.company_id)
      .in('role', ['admin', 'owner'])
      .eq('status', 'active');
    adminEmails = (admins || []).map(a => a.email).filter(Boolean);
  }

  const formatDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const typeLabel = leaveRequest.leave_type ? leaveRequest.leave_type.charAt(0).toUpperCase() + leaveRequest.leave_type.slice(1) : 'Leave';

  let subject = '';
  let html = '';
  let to = [];

  if (action === 'new_request') {
    subject = `New Leave Request — ${employee.full_name || employee.email}`;
    to = adminEmails;
    html = buildEmail({
      heading: 'New Leave Request',
      bodyText: `${employee.full_name || employee.email} has submitted a new leave request.`,
      details: [
        { label: 'Employee', value: employee.full_name || employee.email },
        { label: 'Type', value: typeLabel },
        { label: 'Start', value: formatDate(leaveRequest.start_date) },
        { label: 'End', value: formatDate(leaveRequest.end_date) },
        { label: 'Days', value: String(leaveRequest.days_requested) },
        ...(leaveRequest.notes ? [{ label: 'Note', value: leaveRequest.notes }] : [])
      ],
      ctaText: 'Review Request',
      ctaUrl: 'https://smartcoretechnology.co.uk/holidaymanagement/admin.html',
      color: '#f0ad4e'
    });
  } else if (action === 'decision') {
    const approved = decision === 'approved';
    subject = `Leave Request ${approved ? 'Approved' : 'Rejected'}`;
    to = [employee.email];
    html = buildEmail({
      heading: approved ? 'Leave Request Approved ✓' : 'Leave Request Rejected',
      bodyText: approved
        ? 'Your leave request has been approved.'
        : 'Unfortunately your leave request has been rejected.',
      details: [
        { label: 'Type', value: typeLabel },
        { label: 'Start', value: formatDate(leaveRequest.start_date) },
        { label: 'End', value: formatDate(leaveRequest.end_date) },
        { label: 'Days', value: String(leaveRequest.days_requested) },
        ...(note ? [{ label: 'Manager Note', value: note }] : [])
      ],
      ctaText: 'View My Leave',
      ctaUrl: 'https://smartcoretechnology.co.uk/holidaymanagement/my-leave.html',
      color: approved ? '#1fb67a' : '#d9534f'
    });
  } else if (action === 'cancel_request') {
    subject = `Cancellation Requested — ${employee.full_name || employee.email}`;
    to = adminEmails;
    html = buildEmail({
      heading: 'Cancellation Requested',
      bodyText: `${employee.full_name || employee.email} has requested cancellation of an approved leave.`,
      details: [
        { label: 'Employee', value: employee.full_name || employee.email },
        { label: 'Type', value: typeLabel },
        { label: 'Start', value: formatDate(leaveRequest.start_date) },
        { label: 'End', value: formatDate(leaveRequest.end_date) },
        ...(reason ? [{ label: 'Reason', value: reason }] : [])
      ],
      ctaText: 'Review Request',
      ctaUrl: 'https://smartcoretechnology.co.uk/holidaymanagement/admin.html',
      color: '#f0ad4e'
    });
  } else {
    return new Response('Unknown action', { status: 400 });
  }

  if (!to.length) {
    return Response.json({ success: true, skipped: 'No recipients' });
  }

  // Send to each recipient
  for (const recipient of to) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'SmartCore Technology <noreply@smartcoretechnology.co.uk>',
        to: [recipient],
        subject,
        html
      })
    });
  }

  return Response.json({ success: true });
}

function buildEmail({ heading, bodyText, details, ctaText, ctaUrl, color }) {
  const rows = details.map(d =>
    `<tr>
      <td style="padding:8px 0;color:#9fb1c9;font-size:0.9rem;width:120px;vertical-align:top">${d.label}</td>
      <td style="padding:8px 0;font-weight:700;vertical-align:top">${d.value}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="font-family:Inter,system-ui,sans-serif;background:#07111f;color:#f4f7fb;margin:0;padding:40px 20px">
  <div style="max-width:520px;margin:0 auto;background:rgba(12,25,45,0.9);border:1px solid rgba(120,160,255,0.18);border-radius:20px;padding:36px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
      <div style="width:40px;height:40px;background:#2d7cff;border-radius:10px;display:flex;align-items:center;justify-content:center">
        <span style="color:#fff;font-size:18px">📅</span>
      </div>
      <div>
        <div style="font-weight:700;font-size:15px">SmartCore Technology</div>
        <div style="font-size:11px;color:#9fb1c9;text-transform:uppercase;letter-spacing:0.08em">Holiday Management</div>
      </div>
    </div>

    <h1 style="margin:0 0 8px;font-size:1.3rem;color:${color}">${heading}</h1>
    <p style="color:#9fb1c9;margin:0 0 20px">${bodyText}</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${rows}</table>

    <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(180deg,${color},${color}cc);color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700">
      ${ctaText}
    </a>

    <p style="color:#9fb1c9;font-size:0.82rem;margin-top:24px;border-top:1px solid rgba(255,255,255,0.08);padding-top:16px">
      SmartCore Technology Holiday Management · <a href="https://smartcoretechnology.co.uk" style="color:#9ec5ff">smartcoretechnology.co.uk</a>
    </p>
  </div>
</body>
</html>`;
}
