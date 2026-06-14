const SCHEMA = 'holidaymanagement';

function db(supabaseUrl, serviceKey) {
  const base = `${supabaseUrl}/rest/v1`;
  const h = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Accept-Profile': SCHEMA,
    'Content-Profile': SCHEMA,
    'Prefer': 'return=representation'
  };
  return {
    async select(table, query = '') {
      const res = await fetch(`${base}/${table}?${query}`, { headers: h });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return JSON.parse(text);
    }
  };
}

const fmt = d => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

export async function onRequestPost({ request, env }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !RESEND_API_KEY) {
    return new Response('Missing environment variables', { status: 500 });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { action, request: leaveRequest, decision, note, reason } = body;
  if (!action || !leaveRequest) return new Response('action and request are required', { status: 400 });

  const client = db(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const typeLabel = cap(leaveRequest.leave_type);

  // Get employee email
  const employees = await client.select('employees', `id=eq.${leaveRequest.employee_id}&select=email,full_name`);
  const employee = employees?.[0];
  if (!employee?.email) return Response.json({ success: false, reason: 'No employee email' });

  let to = [];
  let subject = '';
  let html = '';

  if (action === 'new_request' || action === 'cancel_request') {
    const admins = await client.select(
      'employees',
      `company_id=eq.${leaveRequest.company_id}&role=in.(admin,owner)&status=eq.active&select=email`
    );
    to = (admins || []).map(a => a.email).filter(Boolean);
  }

  if (action === 'new_request') {
    subject = `New Leave Request — ${employee.full_name || employee.email}`;
    html = buildEmail({
      heading: 'New Leave Request',
      bodyText: `${employee.full_name || employee.email} has submitted a new leave request.`,
      details: [
        { label: 'Employee', value: employee.full_name || employee.email },
        { label: 'Type', value: typeLabel },
        { label: 'Start', value: fmt(leaveRequest.start_date) },
        { label: 'End', value: fmt(leaveRequest.end_date) },
        { label: 'Days', value: String(leaveRequest.days_requested) },
        ...(leaveRequest.notes ? [{ label: 'Note', value: leaveRequest.notes }] : [])
      ],
      ctaText: 'Review Request',
      ctaUrl: 'https://smartcoretechnology.co.uk/holidaymanagement/admin.html',
      color: '#f0ad4e'
    });
  } else if (action === 'decision') {
    const approved = decision === 'approved';
    to = [employee.email];
    subject = `Leave Request ${approved ? 'Approved' : 'Rejected'}`;
    html = buildEmail({
      heading: approved ? 'Leave Request Approved ✓' : 'Leave Request Rejected',
      bodyText: approved ? 'Your leave request has been approved.' : 'Unfortunately your leave request has been rejected.',
      details: [
        { label: 'Type', value: typeLabel },
        { label: 'Start', value: fmt(leaveRequest.start_date) },
        { label: 'End', value: fmt(leaveRequest.end_date) },
        { label: 'Days', value: String(leaveRequest.days_requested) },
        ...(note ? [{ label: 'Manager Note', value: note }] : [])
      ],
      ctaText: 'View My Leave',
      ctaUrl: 'https://smartcoretechnology.co.uk/holidaymanagement/my-leave.html',
      color: approved ? '#1fb67a' : '#d9534f'
    });
  } else if (action === 'cancel_request') {
    subject = `Cancellation Requested — ${employee.full_name || employee.email}`;
    html = buildEmail({
      heading: 'Cancellation Requested',
      bodyText: `${employee.full_name || employee.email} has requested cancellation of an approved leave.`,
      details: [
        { label: 'Employee', value: employee.full_name || employee.email },
        { label: 'Type', value: typeLabel },
        { label: 'Start', value: fmt(leaveRequest.start_date) },
        { label: 'End', value: fmt(leaveRequest.end_date) },
        ...(reason ? [{ label: 'Reason', value: reason }] : [])
      ],
      ctaText: 'Review Request',
      ctaUrl: 'https://smartcoretechnology.co.uk/holidaymanagement/admin.html',
      color: '#f0ad4e'
    });
  } else {
    return new Response('Unknown action', { status: 400 });
  }

  if (!to.length) return Response.json({ success: true, skipped: 'No recipients' });

  for (const recipient of to) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
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
    `<tr><td style="padding:8px 0;color:#9fb1c9;font-size:.9rem;width:120px;vertical-align:top">${d.label}</td><td style="padding:8px 0;font-weight:700;vertical-align:top">${d.value}</td></tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Inter,sans-serif;background:#07111f;color:#f4f7fb;margin:0;padding:40px 20px">
  <div style="max-width:520px;margin:0 auto;background:rgba(12,25,45,.9);border:1px solid rgba(120,160,255,.18);border-radius:20px;padding:36px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
      <div style="width:40px;height:40px;background:#2d7cff;border-radius:10px;text-align:center;line-height:40px;font-size:18px">📅</div>
      <div><div style="font-weight:700">SmartCore Technology</div><div style="font-size:11px;color:#9fb1c9;text-transform:uppercase;letter-spacing:.08em">Holiday Management</div></div>
    </div>
    <h1 style="margin:0 0 8px;font-size:1.3rem;color:${color}">${heading}</h1>
    <p style="color:#9fb1c9;margin:0 0 20px">${bodyText}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">${rows}</table>
    <a href="${ctaUrl}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700">${ctaText}</a>
    <p style="color:#9fb1c9;font-size:.82rem;margin-top:24px;border-top:1px solid rgba(255,255,255,.08);padding-top:16px">SmartCore Technology Holiday Management</p>
  </div>
</body></html>`;
}
