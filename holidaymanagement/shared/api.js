import { supabase, leaveSchema } from './supabase.js';

export function leaveTypeLabel(value) {
  if (value === 'annual') return 'Annual Request';
  if (value === 'sick') return 'Sick Leave';
  return 'Other Leave';
}

export function dayTypeLabel(value) {
  if (value === 'half_am') return 'Half Day - Morning';
  if (value === 'half_pm') return 'Half Day - Afternoon';
  return 'Full Day';
}

/* =========================================================
   EMPLOYEES
========================================================= */

export async function getEmployeesByCompany() {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .rpc('get_employees');

  if (error) throw error;

  return (data || []).map((employee) => ({
    ...employee,
    display_name: employee.full_name || 'Employee',
    employee_name: employee.full_name || 'Employee',
    employee_id_display: employee.employee_code || '—'
  }));
}

export async function searchEmployees(companyId, searchTerm) {
  const employees = await getEmployeesByCompany(companyId);
  const term = String(searchTerm || '').toLowerCase();

  if (term.length < 2) return [];

  return employees
    .filter((employee) => JSON.stringify(employee).toLowerCase().includes(term))
    .slice(0, 10);
}

export async function upsertEmployee(payload) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .rpc('upsert_employee', { payload });

  if (error) {
    if (error.message?.includes('MAX_EMPLOYEES_REACHED')) {
      throw new Error(
        'Sorry, your plan has reached the maximum number of employees. Please contact support@smartcoretechnology.co.uk to upgrade your plan.'
      );
    }

    throw error;
  }

  return data;
}

export async function archiveEmployee(employee) {
  return upsertEmployee({
    ...employee,
    employment_status: 'archived'
  });
}

export async function restoreEmployee(employee) {
  return upsertEmployee({
    ...employee,
    employment_status: 'active'
  });
}

export async function getEmployeeByUserId(userId) {
  if (!userId) return null;

  const employees = await getEmployeesByCompany();
  return employees.find((employee) => employee.user_id === userId) || null;
}

export async function updateMyEmployeeProfile(profile, updates) {
  const payload = {
    id: profile.employee_id || profile.id,
    company_id: profile.company_id,
    user_id: profile.user_id,

    employee_code: profile.employee_code,
    full_name: updates.full_name,
    job_title: updates.job_title,
    work_email: updates.work_email,
    personal_email: updates.personal_email,
    personal_phone: updates.personal_phone,
    employment_type: updates.employment_type,
    notice_period: updates.notice_period,
    start_date: updates.start_date,

    role: profile.role,
    is_admin: profile.is_admin,
    annual_leave_allowance: profile.annual_leave_allowance,
    employment_status: 'active',
    onboarding_status: 'complete',

    title: updates.title,
    pronouns: updates.pronouns,
    gender: updates.gender || '',
    dob: updates.dob,
    nationality: updates.nationality || '',
    ni_number: updates.ni_number,
    passport_number: updates.passport_number || '',
    passport_expiry_date: updates.passport_expiry_date || '',
    driving_licence_number: updates.driving_licence_number || '',

    address_line1: updates.address_line1,
    address_line2: updates.address_line2,
    address_city: updates.address_city,
    address_county: updates.address_county,
    address_postcode: updates.address_postcode,
    address_country: updates.address_country,

    emergency_contact_name1: updates.emergency_contact_name1,
    emergency_contact_relationship1: updates.emergency_contact_relationship1,
    emergency_contact_email1: updates.emergency_contact_email1,
    emergency_contact_phone1: updates.emergency_contact_phone1,

    emergency_contact_name2: updates.emergency_contact_name2,
    emergency_contact_relationship2: updates.emergency_contact_relationship2,
    emergency_contact_email2: updates.emergency_contact_email2,
    emergency_contact_phone2: updates.emergency_contact_phone2
  };

  return upsertEmployee(payload);
}

/* =========================================================
   SHIFT PATTERNS
========================================================= */

export async function getShiftPatterns(companyId) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('shift_patterns')
    .select('*')
    .eq('company_id', companyId)
    .order('name');

  if (error) throw error;
  return data || [];
}

export async function createShiftPattern(payload) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('shift_patterns')
    .insert([payload])
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

/* =========================================================
   LEAVE BALANCES
========================================================= */

export async function getMyLeaveBalance(userId, year) {
  if (!userId) return null;

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_balances')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getEmployeeLeaveBalanceByYear(userId, year) {
  if (!userId) return null;

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_balances')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/* =========================================================
   MY LEAVE / SICK
========================================================= */

export async function getMyLeaveRequests(userId) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getMySickRecords(userId) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('sick_records')
    .select('*')
    .eq('user_id', userId)
    .order('sick_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

/* =========================================================
   COMPANY LEAVE
========================================================= */

export async function getAllCompanyLeaveRequests(companyId) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getAllCompanySickRecords(companyId) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('sick_records')
    .select('*')
    .eq('company_id', companyId)
    .order('sick_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function enrichRequestsWithEmployeeInfo(requests) {
  const employees = await getEmployeesByCompany();

  const byEmployeeId = new Map(employees.map((employee) => [employee.id, employee]));
  const byUserId = new Map(
    employees
      .filter((employee) => employee.user_id)
      .map((employee) => [employee.user_id, employee])
  );

  return (requests || []).map((request) => {
    const employee = byEmployeeId.get(request.employee_id) || byUserId.get(request.user_id);

    return {
      ...request,
      employee,
      employee_name: employee?.full_name || 'Employee',
      display_name: employee?.full_name || 'Employee',
      employee_id_display: employee?.employee_code || '—',
      employee_id: employee?.employee_code || '—',
      job_title: employee?.job_title || '—',
      employee_email: employee?.work_email || employee?.personal_email || null,
      work_email: employee?.work_email || null,
      personal_email: employee?.personal_email || null
    };
  });
}

/* =========================================================
   CALENDAR
========================================================= */

export async function getApprovedLeaveForDate(companyId, isoDate) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .rpc('get_calendar_leave_for_date', {
      p_company_id: companyId,
      p_date: isoDate
    });

  if (error) throw error;
  return data || [];
}

export async function getApprovedLeaveInRange(companyId, startDate, endDate) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .lte('start_date', endDate)
    .gte('end_date', startDate)
    .order('start_date', { ascending: true });

  if (error) throw error;
  return enrichRequestsWithEmployeeInfo(data || []);
}

export async function getLeaveOverlap(companyId, startDate, endDate) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .rpc('get_leave_overlap', {
      p_company_id: companyId,
      p_start_date: startDate,
      p_end_date: endDate
    });

  if (error) throw error;
  return data || [];
}

/* =========================================================
   DASHBOARD BREAKDOWN
========================================================= */

export async function getDashboardLeaveBreakdown(companyId) {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const next7 = new Date(today);
  next7.setDate(next7.getDate() + 7);
  const next7Iso = next7.toISOString().slice(0, 10);

  const approved = await getApprovedLeaveInRange(companyId, todayIso, next7Iso);
  const employees = await getEmployeesByCompany();

  const annualToday = approved.filter((request) =>
    request.leave_type === 'annual' &&
    request.start_date <= todayIso &&
    request.end_date >= todayIso
  );

  const sickToday = approved.filter((request) =>
    request.leave_type === 'sick' &&
    request.start_date <= todayIso &&
    request.end_date >= todayIso
  );

  const otherToday = approved.filter((request) =>
    request.leave_type === 'other' &&
    request.start_date <= todayIso &&
    request.end_date >= todayIso
  );

  const annualNext7 = approved.filter((request) => request.leave_type === 'annual');
  const sickNext7 = approved.filter((request) => request.leave_type === 'sick');
  const otherNext7 = approved.filter((request) => request.leave_type === 'other');

  const birthdaysNext7 = employees.filter((employee) => {
    if (!employee.dob) return false;
    const dob = new Date(employee.dob);

    for (let i = 0; i <= 7; i += 1) {
      const check = new Date(today);
      check.setDate(today.getDate() + i);

      if (check.getMonth() === dob.getMonth() && check.getDate() === dob.getDate()) {
        return true;
      }
    }

    return false;
  });

  const workAnniversariesNext7 = employees.filter((employee) => {
    if (!employee.start_date) return false;
    const start = new Date(employee.start_date);

    for (let i = 0; i <= 7; i += 1) {
      const check = new Date(today);
      check.setDate(today.getDate() + i);

      if (check.getMonth() === start.getMonth() && check.getDate() === start.getDate()) {
        return true;
      }
    }

    return false;
  });

  const startersNext7 = employees.filter((employee) =>
    employee.start_date && employee.start_date >= todayIso && employee.start_date <= next7Iso
  );

  const leaveStartingNext7 = approved.filter((request) =>
    request.start_date >= todayIso && request.start_date <= next7Iso
  );

  return {
    annualToday,
    sickToday,
    otherToday,
    annualNext7,
    sickNext7,
    otherNext7,
    birthdaysNext7,
    workAnniversariesNext7,
    startersNext7,
    leaveStartingNext7
  };
}

/* =========================================================
   NOTIFICATIONS
========================================================= */

export async function sendLeaveRequestNotification(payload) {
  const response = await fetch('/api/send-leave-request-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) console.warn('Leave notification failed:', result);
  return result;
}

export async function sendLeaveCancelNotification(payload) {
  const response = await fetch('/api/send-leave-cancel-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) console.warn('Cancel notification failed:', result);
  return result;
}

export async function getLeaveAuthoriserNotificationInfo(employeeId) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .rpc('get_leave_authoriser_notification_info', {
      p_employee_id: employeeId
    });

  if (error) throw error;
  return data?.[0] || null;
}

export async function sendLeaveDecisionNotification(payload) {
  const response = await fetch('/api/send-leave-decision-notification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) console.warn('Leave decision notification failed:', result);
  return result;
}

export async function sendSupportLeaveApprovedEmail(payload) {
  const response = await fetch('/api/send-support-leave-approved-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) console.warn('Support approval email failed:', result);
  return result;
}

/* =========================================================
   CREATE REQUESTS
========================================================= */

export async function calculateEmployeeLeaveDays(payload) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .rpc('calculate_employee_leave_days', {
      p_employee_id: payload.employee_id,
      p_company_id: payload.company_id,
      p_start_date: payload.start_date,
      p_end_date: payload.end_date,
      p_leave_type: payload.leave_type || 'annual',
      p_day_type: payload.day_type || 'full'
    });

  if (error) throw error;
  return Number(data || 0);
}

export async function createLeaveRequest(payload) {
  const employee = await getEmployeeByUserId(payload.user_id);

  const isOwnerAutoApprove =
    employee?.role === 'owner' &&
    employee?.no_authoriser_required === true;

  let totalDays = Number(payload.total_days || 0);

  try {
    totalDays = await calculateEmployeeLeaveDays({
      employee_id: payload.employee_id || employee?.id || null,
      company_id: payload.company_id,
      start_date: payload.start_date,
      end_date: payload.end_date,
      leave_type: payload.leave_type,
      day_type: payload.day_type || 'full'
    });
  } catch (error) {
    console.warn('Server day calculation failed, using submitted total:', error);
  }

  const insertPayload = {
    ...payload,
    employee_id: payload.employee_id || employee?.id || null,
    day_type: payload.day_type || 'full',
    total_days: totalDays,
    status: isOwnerAutoApprove ? 'approved' : 'pending',
    approved_at: isOwnerAutoApprove ? new Date().toISOString() : null,
    approved_by: isOwnerAutoApprove ? payload.user_id : null,
    deduct_allowance: payload.leave_type !== 'sick'
  };

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .insert([insertPayload])
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Leave request was inserted, but no row was returned.');

  await supabase.schema(leaveSchema).from('leave_logs').insert([{
    leave_request_id: data.id,
    action: isOwnerAutoApprove ? 'approved' : 'created',
    performed_by: payload.user_id,
    details: insertPayload
  }]);

  if (!isOwnerAutoApprove && insertPayload.employee_id) {
    try {
      const notifyInfo = await getLeaveAuthoriserNotificationInfo(insertPayload.employee_id);

      if (notifyInfo?.authoriser_email) {
        await sendLeaveRequestNotification({
          to: notifyInfo.authoriser_email,
          authoriser_name: notifyInfo.authoriser_name,
          employee_name: notifyInfo.employee_name,
          leave_type: payload.leave_type,
          day_type: insertPayload.day_type,
          start_date: payload.start_date,
          end_date: payload.end_date,
          total_days: totalDays,
          manage_url: `${window.location.origin}/holidaymanagement/admin.html?request=${data.id}`
        });
      }
    } catch (notificationError) {
      console.warn('Leave notification failed:', notificationError);
    }
  }

  return data;
}

export async function createManualAbsence(payload, authorisingUserId) {
  let totalDays = Number(payload.total_days || 0);

  try {
    totalDays = await calculateEmployeeLeaveDays({
      employee_id: payload.employee.id,
      company_id: payload.company_id,
      start_date: payload.start_date,
      end_date: payload.end_date,
      leave_type: payload.leave_type,
      day_type: payload.day_type || 'full'
    });
  } catch (error) {
    console.warn('Server day calculation failed, using submitted total:', error);
  }

  const insertPayload = {
    user_id: payload.employee.user_id || null,
    employee_id: payload.employee.id,
    company_id: payload.company_id,
    leave_type: payload.leave_type,
    day_type: payload.day_type || 'full',
    start_date: payload.start_date,
    end_date: payload.end_date,
    total_days: totalDays,
    status: 'approved',
    reason: payload.reason || null,
    notes: `Manually added by admin.${payload.authorising_name ? ` Authorising user: ${payload.authorising_name}.` : ''}`,
    approved_by: authorisingUserId,
    approved_at: new Date().toISOString(),
    deduct_allowance: payload.deduct_allowance
  };

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .insert([insertPayload])
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Manual absence could not be saved.');

  await supabase.schema(leaveSchema).from('leave_logs').insert([{
    leave_request_id: data.id,
    action: 'approved',
    performed_by: authorisingUserId,
    details: {
      manual_absence: true,
      leave_type: payload.leave_type,
      day_type: payload.day_type || 'full',
      employee_id: payload.employee.id,
      reason: payload.reason || null,
      deduct_allowance: payload.deduct_allowance
    }
  }]);

  return data;
}

/* =========================================================
   APPROVE / REJECT / CANCEL / AMEND
========================================================= */

export async function approveLeaveRequest(request, approverId, note = '', deductAllowance = true) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      status: 'approved',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      notes: note || request.notes || null,
      deduct_allowance: deductAllowance
    })
    .eq('id', request.id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('The request could not be approved.');

  await supabase.schema(leaveSchema).from('leave_logs').insert([{
    leave_request_id: request.id,
    action: 'approved',
    performed_by: approverId,
    details: { note, deduct_allowance: deductAllowance }
  }]);

  try {
    await sendLeaveDecisionNotification({
      status: 'approved',
      to: request.employee_email || request.personal_email || request.work_email,
      employee_name: request.employee_name || 'Employee',
      leave_type: leaveTypeLabel(request.leave_type),
      day_type: dayTypeLabel(request.day_type),
      start_date: request.start_date,
      end_date: request.end_date,
      total_days: request.total_days,
      note
    });
  } catch (notificationError) {
    console.warn('Approval notification failed:', notificationError);
  }

  return true;
}

export async function rejectLeaveRequest(request, approverId, note = '') {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      status: 'rejected',
      approved_by: approverId,
      approved_at: new Date().toISOString(),
      notes: note || request.notes || null
    })
    .eq('id', request.id)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('The request could not be rejected.');

  await supabase.schema(leaveSchema).from('leave_logs').insert([{
    leave_request_id: request.id,
    action: 'rejected',
    performed_by: approverId,
    details: { note }
  }]);

  try {
    await sendLeaveDecisionNotification({
      status: 'rejected',
      to: request.employee_email || request.personal_email || request.work_email,
      employee_name: request.employee_name || 'Employee',
      leave_type: leaveTypeLabel(request.leave_type),
      day_type: dayTypeLabel(request.day_type),
      start_date: request.start_date,
      end_date: request.end_date,
      total_days: request.total_days,
      note
    });
  } catch (notificationError) {
    console.warn('Rejection notification failed:', notificationError);
  }

  return true;
}

export async function requestLeaveCancellation(request, userId, reason) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      status: 'cancel_requested',
      cancellation_requested_at: new Date().toISOString(),
      cancellation_requested_by: userId,
      cancellation_reason: reason || null
    })
    .eq('id', request.id)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Cancellation request could not be submitted.');

  try {
    const notifyInfo = await getLeaveAuthoriserNotificationInfo(request.employee_id);

    if (notifyInfo?.authoriser_email) {
      await sendLeaveCancelNotification({
        to: notifyInfo.authoriser_email,
        type: 'employee_requested_cancel',
        employee_name: notifyInfo.employee_name || request.employee_name || 'Employee',
        leave_type: request.leave_type,
        day_type: request.day_type || 'full',
        start_date: request.start_date,
        end_date: request.end_date,
        reason,
        manage_url: `${window.location.origin}/holidaymanagement/admin.html?request=${request.id}`
      });
    }
  } catch (error) {
    console.warn('Cancellation email failed:', error);
  }

  return data;
}

export async function cancelLeaveRequestAdmin(request, adminId, reason = '') {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: adminId,
      cancel_admin_reason: reason || null
    })
    .eq('id', request.id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Leave could not be cancelled.');

  await supabase.schema(leaveSchema).from('leave_logs').insert([{
    leave_request_id: request.id,
    action: 'cancelled',
    performed_by: adminId,
    details: { reason }
  }]);

  try {
    if (request.employee_email || request.personal_email || request.work_email) {
      await sendLeaveCancelNotification({
        type: 'admin_cancelled',
        to: request.employee_email || request.personal_email || request.work_email,
        employee_name: request.employee_name || 'Employee',
        leave_type: request.leave_type,
        day_type: request.day_type || 'full',
        start_date: request.start_date,
        end_date: request.end_date,
        reason
      });
    }
  } catch (error) {
    console.warn('Admin cancellation email failed:', error);
  }

  return data;
}

export async function amendLeaveRequestAdmin(request, adminId, payload) {
  let totalDays = Number(payload.total_days || 0);

  try {
    totalDays = await calculateEmployeeLeaveDays({
      employee_id: request.employee_id,
      company_id: request.company_id,
      start_date: payload.start_date,
      end_date: payload.end_date,
      leave_type: request.leave_type,
      day_type: payload.day_type || request.day_type || 'full'
    });
  } catch (error) {
    console.warn('Server day calculation failed, using submitted total:', error);
  }

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      start_date: payload.start_date,
      end_date: payload.end_date,
      day_type: payload.day_type || request.day_type || 'full',
      total_days: totalDays,
      amendment_reason: payload.reason || null,
      amended_by: adminId,
      amended_at: new Date().toISOString()
    })
    .eq('id', request.id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Leave could not be amended.');

  await supabase.schema(leaveSchema).from('leave_logs').insert([{
    leave_request_id: request.id,
    action: 'edited',
    performed_by: adminId,
    details: {
      ...payload,
      total_days: totalDays
    }
  }]);

  return data;
}

/* =========================================================
   EMPLOYEE LEAVE SUMMARY
========================================================= */

export async function getEmployeeLeaveSummary(request) {
  const userId = request.user_id;
  const employeeUuid = request.employee?.id || request.employee_id || null;
  const year = new Date().getFullYear();

  let balance = null;
  if (userId) balance = await getMyLeaveBalance(userId, year);

  let query = supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .select('*')
    .eq('company_id', request.company_id)
    .order('start_date', { ascending: false });

  if (employeeUuid) {
    query = query.eq('employee_id', employeeUuid);
  } else if (userId) {
    query = query.eq('user_id', userId);
  } else {
    return { balance, requests: [] };
  }

  const { data, error } = await query;
  if (error) throw error;

  return {
    balance,
    requests: data || []
  };
}

/* =========================================================
   SICKNESS EPISODES
========================================================= */

export async function createSicknessEpisode(payload, adminId) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('sickness_episodes')
    .insert([{ ...payload, created_by: adminId }])
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function closeSicknessEpisode(id, endDate, adminId, notes = '') {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('sickness_episodes')
    .update({
      end_date: endDate,
      status: 'closed',
      closed_by: adminId,
      closed_at: new Date().toISOString(),
      notes
    })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getSicknessEpisodes(companyId) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('sickness_episodes')
    .select('*')
    .eq('company_id', companyId)
    .order('start_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

/* =========================================================
   HOLIDAYS
========================================================= */

export async function getBankHolidays(region = 'england') {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('bank_holidays')
    .select('*')
    .eq('region', region)
    .order('holiday_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getCompanyHolidays(companyId) {
  const bankHolidays = await getBankHolidays('england');

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('company_holidays')
    .select('holiday_date, name')
    .eq('company_id', companyId)
    .order('holiday_date', { ascending: true });

  if (error) return bankHolidays;

  return [...bankHolidays, ...(data || [])];
}

export async function getAllHolidayDates(companyId) {
  const bank = await getBankHolidays('england');

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('company_holidays')
    .select('*')
    .eq('company_id', companyId)
    .order('holiday_date');

  if (error) throw error;

  return [
    ...bank.map((item) => ({ ...item, type: 'bank' })),
    ...(data || []).map((item) => ({ ...item, type: 'company' }))
  ];
}

export async function addCompanyHoliday(payload) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('company_holidays')
    .insert([payload])
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function deleteCompanyHoliday(id) {
  const { error } = await supabase
    .schema(leaveSchema)
    .from('company_holidays')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function updateCompanyHoliday(id, payload) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('company_holidays')
    .update(payload)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateBankHoliday(id, payload) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('bank_holidays')
    .update(payload)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

/* =========================================================
   COMPANY / ONBOARDING / INVITES
========================================================= */

export async function getMyCompanyInfo() {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .rpc('get_my_company_info');

  if (error) throw error;
  return data?.[0] || null;
}

export async function sendEmployeeInvite(payload) {
  const response = await fetch('/api/send-employee-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Invitation could not be sent.');
  return result;
}

export async function completeEmployeeOnboarding(payload) {
  const response = await fetch('/api/complete-employee-onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Onboarding could not be completed.');
  return result;
}

export async function deleteEmployeePermanent(employeeId) {
  const response = await fetch('/api/delete-employee-permanent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ employee_id: employeeId })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Employee could not be deleted.');
  return result;
}

/* =========================================================
   EMPLOYEE REPORTS
========================================================= */

export async function getEmployeeAllLeave(employeeId) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .select('*')
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getEmployeeLeaveReport(employeeId) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .select('*')
    .eq('employee_id', employeeId)
    .order('start_date', { ascending: false });

  if (error) throw error;
  return data || [];
}
