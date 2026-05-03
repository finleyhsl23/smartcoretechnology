import { supabase, leaveSchema } from './supabase.js';

function safeName(employee, fallback = 'Employee') {
  if (!employee) return fallback;
  if (employee.full_name) return employee.full_name;

  const first = employee.first_name || '';
  const last = employee.last_name || '';
  const combined = `${first} ${last}`.trim();

  return combined || employee.name || employee.email || employee.work_email || fallback;
}

export async function getMyLeaveBalance(userId, year) {
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

export async function getCompanyHolidays(companyId) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('company_holidays')
    .select('holiday_date')
    .eq('company_id', companyId)
    .order('holiday_date', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function createLeaveRequest(payload) {
  const employee = await getEmployeeByUserId(payload.user_id);

  const insertPayload = {
    ...payload,
    employee_id: employee?.id || null
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

export async function getEmployeesByCompany(companyId) {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('company_id', companyId)
    .order('full_name', { ascending: true });

  if (error) throw error;

  return (data || []).map((employee) => ({
    ...employee,
    display_name: safeName(employee)
  }));
}

export async function searchEmployees(companyId, searchTerm) {
  const term = String(searchTerm || '').trim();

  if (term.length < 2) return [];

  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('company_id', companyId)
    .or(`full_name.ilike.%${term}%,employee_code.ilike.%${term}%,work_email.ilike.%${term}%,email.ilike.%${term}%`)
    .limit(8);

  if (error) throw error;

  return (data || []).map((employee) => ({
    ...employee,
    display_name: safeName(employee)
  }));
}

export async function getEmployeeByUserId(userId) {
  if (!userId) return null;

  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) return null;

  return {
    ...data,
    display_name: safeName(data)
  };
}

export async function enrichRequestsWithEmployeeInfo(requests, companyId) {
  const employees = await getEmployeesByCompany(companyId);

  const byEmployeeId = new Map(employees.map((employee) => [employee.id, employee]));
  const byUserId = new Map(employees.filter((employee) => employee.user_id).map((employee) => [employee.user_id, employee]));

  return (requests || []).map((request) => {
    const employee = byEmployeeId.get(request.employee_id) || byUserId.get(request.user_id);

    return {
      ...request,
      employee,
      employee_name: employee?.display_name || 'Employee',
      employee_id: employee?.employee_code || employee?.employee_id || '—',
      job_title: employee?.job_title || '—'
    };
  });
}

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
  return enrichRequestsWithEmployeeInfo(data || [], companyId);
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
  return enrichRequestsWithEmployeeInfo(data || [], companyId);
}

export async function getDashboardLeaveBreakdown(companyId) {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const next7 = new Date(today);
  next7.setDate(next7.getDate() + 7);
  const next7Iso = next7.toISOString().slice(0, 10);

  const approved = await getApprovedLeaveInRange(companyId, todayIso, next7Iso);
  const employees = await getEmployeesByCompany(companyId);

  const annualToday = approved.filter((r) => r.leave_type === 'annual' && r.start_date <= todayIso && r.end_date >= todayIso);
  const sickToday = approved.filter((r) => r.leave_type === 'sick' && r.start_date <= todayIso && r.end_date >= todayIso);
  const otherToday = approved.filter((r) => r.leave_type === 'other' && r.start_date <= todayIso && r.end_date >= todayIso);

  const annualNext7 = approved.filter((r) => r.leave_type === 'annual');
  const sickNext7 = approved.filter((r) => r.leave_type === 'sick');
  const otherNext7 = approved.filter((r) => r.leave_type === 'other');

  const birthdaysNext7 = employees.filter((employee) => {
    if (!employee.dob) return false;

    const dob = new Date(employee.dob);
    const month = dob.getMonth();
    const day = dob.getDate();

    for (let i = 0; i <= 7; i += 1) {
      const check = new Date(today);
      check.setDate(today.getDate() + i);
      if (check.getMonth() === month && check.getDate() === day) return true;
    }

    return false;
  });

  return {
    annualToday,
    sickToday,
    otherToday,
    annualNext7,
    sickNext7,
    otherNext7,
    birthdaysNext7
  };
}

export async function getEmployeeLeaveSummary(request) {
  const userId = request.user_id;
  const employeeId = request.employee_id;
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

  if (employeeId) {
    query = query.eq('employee_id', employeeId);
  } else if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return {
    balance,
    requests: data || []
  };
}

export async function approveLeaveRequest(request, approverId, note = '') {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      status: 'approved',
      approved_by: approverId,
      approved_at: nowIso,
      notes: note || request.notes || null
    })
    .eq('id', request.id)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('The request could not be approved. Check RLS/update permissions.');

  await supabase
    .schema(leaveSchema)
    .from('leave_logs')
    .insert([{
      leave_request_id: request.id,
      action: 'approved',
      performed_by: approverId,
      details: {
        previous_status: request.status,
        approved_at: nowIso,
        note: note || null
      }
    }]);

  if (request.leave_type === 'annual' && request.user_id) {
    const year = new Date(request.start_date).getFullYear();
    const balance = await getMyLeaveBalance(request.user_id, year);

    if (balance) {
      const usedDays = Number(balance.used_days || 0) + Number(request.total_days || 0);
      const remainingDays = Math.max(0, Number(balance.total_allowance || 0) - usedDays);

      const { error: balanceError } = await supabase
        .schema(leaveSchema)
        .from('leave_balances')
        .update({
          used_days: usedDays,
          remaining_days: remainingDays
        })
        .eq('id', balance.id);

      if (balanceError) throw balanceError;
    }
  }

  if (request.leave_type === 'sick') {
    await supabase
      .schema(leaveSchema)
      .from('sick_records')
      .insert([{
        user_id: request.user_id || approverId,
        company_id: request.company_id,
        leave_request_id: request.id,
        sick_date: request.start_date,
        notes: note || request.notes || request.reason || null
      }]);
  }

  return true;
}

export async function rejectLeaveRequest(request, approverId, note = '') {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      status: 'rejected',
      approved_by: approverId,
      approved_at: nowIso,
      notes: note || request.notes || null
    })
    .eq('id', request.id)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('The request could not be rejected. Check RLS/update permissions.');

  await supabase
    .schema(leaveSchema)
    .from('leave_logs')
    .insert([{
      leave_request_id: request.id,
      action: 'rejected',
      performed_by: approverId,
      details: {
        rejected_at: nowIso,
        note: note || null
      }
    }]);

  return true;
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
    approved_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .insert([insertPayload])
    .select()
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
        reason: payload.reason || null
      }
    }]);

  return data;
}
