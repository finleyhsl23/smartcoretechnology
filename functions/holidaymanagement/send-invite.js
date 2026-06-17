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
    async insert(table, data) {
      const res = await fetch(`${base}/${table}`, {
        method: 'POST', headers: h,
        body: JSON.stringify(Array.isArray(data) ? data : [data])
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return text ? JSON.parse(text) : [];
    },
    async select(table, query = '') {
      const res = await fetch(`${base}/${table}?${query}`, { headers: h });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      return JSON.parse(text);
    }
  };
}

export async function onRequestPost({ request, env }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !RESEND_API_KEY) {
    return new Response('Missing environment variables', { status: 500 });
  }

  let body;
  try { body = await request.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const {
    company_id, company_name, invite_type,
    full_name, work_email, personal_email, email,
    role, department, department_id, job_title, annual_leave_allowance,
    employment_type, notice_period, start_date,
    override_allowance_calculation, override_allowance_this_year,
    shift_pattern_id, authoriser_ids,
    employee_code,
    send_to
  } = body;

  if (!company_id || !invite_type) return new Response('Missing required fields: company_id, invite_type', { status: 400 });

  // Determine which email to send the invite to
  const sendToEmail = send_to === 'personal' ? (personal_email || email) : (work_email || email);
  const inviteEmail = sendToEmail;

  if (!inviteEmail) return new Response('Missing required field: email address', { status: 400 });

  const client = db(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const token = crypto.randomUUID();
  const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  // Create employee stub first so we have the employee ID for the invite record
  let newEmployee = null;
  try {
    const employeePayload = {
      company_id,
      full_name: full_name || null,
      work_email: work_email || email || null,
      personal_email: personal_email || null,
      role: role || 'employee',
      department: department || null,
      department_id: department_id || null,
      job_title: job_title || null,
      annual_leave_allowance: annual_leave_allowance ?? 28,
      employment_type: employment_type || null,
      notice_period: notice_period || null,
      start_date: start_date || null,
      override_allowance_calculation: override_allowance_calculation ?? null,
      override_allowance_this_year: override_allowance_this_year ?? null,
      shift_pattern_id: shift_pattern_id || null,
      employee_code: employee_code || null,
      employment_status: 'invited'
    };

    const inserted = await client.insert('employees', employeePayload);
    newEmployee = Array.isArray(inserted) ? inserted[0] : inserted;
  } catch (err) {
    if (!err.message.includes('duplicate') && !err.message.includes('23505')) {
      console.error('Employee stub error:', err.message);
    }
  }

  // Insert authoriser links if provided
  if (newEmployee && authoriser_ids && Array.isArray(authoriser_ids) && authoriser_ids.length > 0) {
    try {
      await client.insert('employee_authorisers', authoriser_ids.map(aid => ({
        employee_id: newEmployee.id,
        authoriser_employee_id: aid,
        company_id
      })));
    } catch (err) {
      console.error('Authoriser insert error:', err.message);
    }
  }

  // Create onboarding invite record
  try {
    await client.insert('onboarding_invites', {
      company_id,
      token,
      email: inviteEmail,
      invite_type,
      full_name: full_name || null,
      role: role || 'employee',
      employee_id: newEmployee?.id || null,
      expires_at
    });
  } catch (err) {
    return new Response('Failed to create invite: ' + err.message, { status: 500 });
  }

  const inviteUrl = `https://smartcoretechnology.co.uk/systems/holidaymanagement/onboarding.html?token=${token}`;
  const isOwner = invite_type === 'owner';
  const displayName = full_name || 'there';
  const companyDisplay = company_name || 'your company';

  // Build info rows for the email
  const infoRows = [
    { label: 'Name', value: full_name },
    { label: 'Role', value: role && role !== 'employee' ? role.charAt(0).toUpperCase() + role.slice(1) : (role === 'employee' ? 'Employee' : null) },
    { label: 'Job Title', value: job_title },
    { label: 'Start Date', value: start_date ? new Date(start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null }
  ].filter(r => r.value);

  const infoRowsHtml = infoRows.length > 0 ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;border-collapse:collapse">
      ${infoRows.map(r => `
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#7b93b0;font-weight:600;text-transform:uppercase;letter-spacing:.06em;width:110px;border-bottom:1px solid rgba(120,160,255,0.1)">${r.label}</td>
        <td style="padding:10px 14px;font-size:14px;color:#d4e2f4;border-bottom:1px solid rgba(120,160,255,0.1)">${r.value}</td>
      </tr>`).join('')}
    </table>` : '';

  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${isOwner ? 'Set up your Holiday Management account' : `You're invited to join ${companyDisplay}`}</title>
</head>
<body style="margin:0;padding:0;background:#07111f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#07111f;min-height:100vh">
    <tr>
      <td align="center" style="padding:48px 20px">

        <!-- Card -->
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:linear-gradient(160deg,#0c1a30 0%,#091526 100%);border:1px solid rgba(80,130,255,0.2);border-radius:20px;overflow:hidden">

          <!-- Top accent bar -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#1d5ed8,#2d7cff,#5ba3ff)"></td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding:32px 36px 0">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle">
                    <!-- Logo mark -->
                    <div style="width:44px;height:44px;background:linear-gradient(135deg,#1d5ed8,#2d7cff);border-radius:11px;text-align:center;line-height:44px;font-size:22px;font-weight:800;color:#fff;display:inline-block">S</div>
                  </td>
                  <td style="vertical-align:middle;padding-left:13px">
                    <div style="font-size:15px;font-weight:700;color:#e8f0fc;letter-spacing:-.01em">SmartCore Technology</div>
                    <div style="font-size:11px;color:#5b7fa6;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">Holiday Management</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="padding:36px 36px 0">
              <div style="font-size:24px;font-weight:700;color:#e8f0fc;line-height:1.3;letter-spacing:-.02em">
                ${isOwner ? 'Set up your company account' : `You're invited to join<br/>${companyDisplay}!`}
              </div>
              <div style="margin-top:14px;font-size:15px;color:#7b93b0;line-height:1.6">
                Hi ${displayName},
              </div>
              <div style="margin-top:8px;font-size:15px;color:#7b93b0;line-height:1.6">
                ${isOwner
                  ? `SmartCore Technology has created a Holiday Management account for <strong style="color:#9fb8d8">${companyDisplay}</strong>. Complete your setup to start managing leave, holidays, and employee time off — all in one place.`
                  : `<strong style="color:#9fb8d8">${companyDisplay}</strong> uses SmartCore Holiday Management to handle leave requests, time off, and holiday approvals. Accept your invitation to get started.`
                }
              </div>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding:32px 36px 0">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:linear-gradient(135deg,#1d5ed8,#2d7cff);border-radius:12px">
                    <a href="${inviteUrl}" style="display:inline-block;padding:16px 36px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:-.01em">
                      ${isOwner ? 'Set Up Your Company' : 'Accept Your Invitation'} &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${infoRowsHtml ? `
          <!-- Info section -->
          <tr>
            <td style="padding:28px 36px 0">
              <div style="font-size:12px;color:#4e6a87;text-transform:uppercase;letter-spacing:.1em;font-weight:600;margin-bottom:4px">Your Details</div>
              <div style="background:rgba(30,55,100,0.35);border:1px solid rgba(80,130,255,0.12);border-radius:12px;overflow:hidden">
                ${infoRowsHtml}
              </div>
            </td>
          </tr>` : ''}

          <!-- What is Holiday Management -->
          <tr>
            <td style="padding:28px 36px 0">
              <div style="background:rgba(20,40,75,0.4);border:1px solid rgba(80,130,255,0.1);border-radius:12px;padding:20px">
                <div style="font-size:13px;font-weight:600;color:#6b8fb5;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">What is Holiday Management?</div>
                <div style="font-size:14px;color:#7b93b0;line-height:1.65">
                  SmartCore Holiday Management lets you request time off, track your leave balance, and stay on top of company holidays — all from one simple dashboard. Once you accept your invitation, you'll be able to complete your profile and start using the system right away.
                </div>
              </div>
            </td>
          </tr>

          <!-- Expiry notice -->
          <tr>
            <td style="padding:24px 36px 0">
              <table cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="background:rgba(255,180,0,0.07);border:1px solid rgba(255,180,0,0.15);border-radius:10px;padding:14px 18px">
                    <div style="font-size:13px;color:#9b8040;line-height:1.5">
                      <strong style="color:#b89648">This link expires in 7 days.</strong> If you didn't expect this email, you can ignore it safely — no action will be taken on your account.
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:28px 36px 32px">
              <div style="border-top:1px solid rgba(80,130,255,0.1);padding-top:24px;text-align:center">
                <div style="font-size:12px;color:#3e5570;line-height:1.7">
                  &copy; SmartCore Technology &middot;
                  <a href="https://smartcoretechnology.co.uk" style="color:#3e6ba0;text-decoration:none">smartcoretechnology.co.uk</a>
                </div>
                <div style="font-size:11px;color:#2e4560;margin-top:4px">
                  This is an automated message — please do not reply directly to this email.
                </div>
              </div>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
</body>
</html>`;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'SmartCore Technology <noreply@smartcoretechnology.co.uk>',
      to: [inviteEmail],
      subject: isOwner
        ? `Set up your Holiday Management account — ${companyDisplay}`
        : `You're invited to join ${companyDisplay} on Holiday Management`,
      html: emailHtml
    })
  });

  if (!resendRes.ok) return new Response('Email send failed: ' + await resendRes.text(), { status: 500 });

  return Response.json({ success: true, token, employee_id: newEmployee?.id || null });
}
