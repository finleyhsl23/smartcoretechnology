import { supabase, leaveSchema } from './supabase.js';

export function leaveTypeLabel(value) {
  if (value === 'annual') return 'Annual Request';
  if (value === 'sick') return 'Sick Leave';
  return 'Other Leave';
}

/* =========================================================
   EMPLOYEES
   Uses encrypted smartfitsinstallationsltd.employees via RPC
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
    .filter((employee) =>
      JSON.stringify(employee).toLowerCase().includes(term)
    )
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

  const byEmployeeId = new Map(
    employees.map((employee) => [employee.id, employee])
  );

  const byUserId = new Map(
    employees
      .filter((employee) => employee.user_id)
      .map((employee) => [employee.user_id, employee])
  );

  return (requests || []).map((request) => {
    const employee =
      byEmployeeId.get(request.employee_id) ||
      byUserId.get(request.user_id);

    return {
      ...request,
      employee,
      employee_name: employee?.full_name || 'Employee',
      display_name: employee?.full_name || 'Employee',
      employee_id_display: employee?.employee_code || '—',
      employee_id: employee?.employee_code || '—',
      job_title: employee?.job_title || '—'
    };
  });
}

/* =========================================================
   CALENDAR
========================================================= */

export async function getApprovedLeaveForDate(companyId, isoDate) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .lte('start_date', isoDate)
    .gte('end_date', isoDate)
    .order('start_date', { ascending: true });

  if (error) throw error;
  return enrichRequestsWithEmployeeInfo(data || []);
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
    const dobMonth = dob.getMonth();
    const dobDay = dob.getDate();

    for (let i = 0; i <= 7; i += 1) {
      const check = new Date(today);
      check.setDate(today.getDate() + i);

      if (check.getMonth() === dobMonth && check.getDate() === dobDay) {
        return true;
      }
    }

    return false;
  });

  const workAnniversariesNext7 = employees.filter((employee) => {
    if (!employee.start_date) return false;

    const start = new Date(employee.start_date);
    const startMonth = start.getMonth();
    const startDay = start.getDate();

    for (let i = 0; i <= 7; i += 1) {
      const check = new Date(today);
      check.setDate(today.getDate() + i);

      if (check.getMonth() === startMonth && check.getDate() === startDay) {
        return true;
      }
    }

    return false;
  });

  const startersNext7 = employees.filter((employee) => {
    if (!employee.start_date) return false;
    return employee.start_date >= todayIso && employee.start_date <= next7Iso;
  });

  const leaveStartingNext7 = approved.filter((request) =>
    request.start_date >= todayIso &&
    request.start_date <= next7Iso
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
   CREATE REQUESTS
========================================================= */

export async function createLeaveRequest(payload) {
  const employee = await getEmployeeByUserId(payload.user_id);

  const insertPayload = {
    ...payload,
    employee_id: employee?.id || null,
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

  await supabase
    .schema(leaveSchema)
    .from('leave_logs')
    .insert([{
      leave_request_id: data.id,
      action: 'created',
      performed_by: payload.user_id,
      details: {
        leave_type: payload.leave_type,
        start_date: payload.start_date,
        end_date: payload.end_date,
        total_days: payload.total_days
      }
    }]);

  return data;
}

export async function createManualAbsence(payload, authorisingUserId) {
  const insertPayload = {
    user_id: payload.employee.user_id || null,
    employee_id: payload.employee.id,
    company_id: payload.company_id,
    leave_type: payload.leave_type,
    start_date: payload.start_date,
    end_date: payload.end_date,
    total_days: payload.total_days,
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

  await supabase
    .schema(leaveSchema)
    .from('leave_logs')
    .insert([{
      leave_request_id: data.id,
      action: 'approved',
      performed_by: authorisingUserId,
      details: {
        manual_absence: true,
        leave_type: payload.leave_type,
        employee_id: payload.employee.id,
        reason: payload.reason || null,
        deduct_allowance: payload.deduct_allowance
      }
    }]);

  await adjustBalance(data, 'deduct');

  return data;
}

/* =========================================================
   APPROVE / REJECT / CANCEL / AMEND
========================================================= */

async function adjustBalance(request, direction = 'deduct') {
  if (!request.deduct_allowance) return;
  if (!['annual', 'other'].includes(request.leave_type)) return;
  if (!request.user_id) return;

  const year = new Date(request.start_date).getFullYear();
  const balance = await getMyLeaveBalance(request.user_id, year);

  if (!balance) return;

  const days = Number(request.total_days || 0);

  const usedDays =
    direction === 'deduct'
      ? Number(balance.used_days || 0) + days
      : Math.max(0, Number(balance.used_days || 0) - days);

  const remainingDays = Math.max(0, Number(balance.total_allowance || 0) - usedDays);

  const { error } = await supabase
    .schema(leaveSchema)
    .from('leave_balances')
    .update({
      used_days: usedDays,
      remaining_days: remainingDays
    })
    .eq('id', balance.id);

  if (error) throw error;
}

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

  await supabase
    .schema(leaveSchema)
    .from('leave_logs')
    .insert([{
      leave_request_id: request.id,
      action: 'approved',
      performed_by: approverId,
      details: {
        note,
        deduct_allowance: deductAllowance
      }
    }]);

  await adjustBalance(data, 'deduct');

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

  await supabase
    .schema(leaveSchema)
    .from('leave_logs')
    .insert([{
      leave_request_id: request.id,
      action: 'rejected',
      performed_by: approverId,
      details: {
        note
      }
    }]);

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
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Cancellation request could not be submitted.');

  return true;
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

  await adjustBalance(request, 'return');

  await supabase
    .schema(leaveSchema)
    .from('leave_logs')
    .insert([{
      leave_request_id: request.id,
      action: 'cancelled',
      performed_by: adminId,
      details: {
        reason
      }
    }]);

  return data;
}

export async function amendLeaveRequestAdmin(request, adminId, payload) {
  const oldRequest = { ...request };

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      start_date: payload.start_date,
      end_date: payload.end_date,
      total_days: payload.total_days,
      amendment_reason: payload.reason || null,
      amended_by: adminId,
      amended_at: new Date().toISOString()
    })
    .eq('id', request.id)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Leave could not be amended.');

  if (oldRequest.status === 'approved' && oldRequest.deduct_allowance) {
    await adjustBalance(oldRequest, 'return');
    await adjustBalance(data, 'deduct');
  }

  await supabase
    .schema(leaveSchema)
    .from('leave_logs')
    .insert([{
      leave_request_id: request.id,
      action: 'edited',
      performed_by: adminId,
      details: payload
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

  if (userId) {
    balance = await getMyLeaveBalance(userId, year);
  }

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
    return {
      balance,
      requests: []
    };
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
    .insert([{
      ...payload,
      created_by: adminId
    }])
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

  if (error) {
    return bankHolidays;
  }

  return [...bankHolidays, ...(data || [])];
}
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
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || 'Invitation could not be sent.');
  }

  return result;
}
export async function completeEmployeeOnboarding(payload) {
  const response = await fetch('/api/complete-employee-onboarding', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || 'Onboarding could not be completed.');
  }

  return result;
}
