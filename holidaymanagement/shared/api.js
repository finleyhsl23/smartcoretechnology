import { supabase, leaveSchema } from './supabase.js';

function getYearStartEnd(year = new Date().getFullYear()) {
  return {
    start: `${year}-01-01`,
    end: `${year}-12-31`
  };
}

function safeEmployeeName(employee, fallback = 'Employee') {
  if (!employee) return fallback;
  if (employee.full_name) return employee.full_name;
  if (employee.name) return employee.name;

  const first = employee.first_name || '';
  const last = employee.last_name || '';
  const combined = `${first} ${last}`.trim();

  return combined || fallback;
}

function normaliseEmployee(employee) {
  if (!employee) return null;

  return {
    ...employee,
    display_name: safeEmployeeName(employee),
    employee_code: employee.employee_code || employee.employee_id || '—',
    employee_id: employee.employee_code || employee.employee_id || '—',
    primary_email: employee.work_email || employee.email || employee.personal_email || '—',
    primary_phone: employee.personal_phone || employee.phone || '—',
    address_full: [
      employee.address_line1,
      employee.address_line2,
      employee.address_city,
      employee.address_county,
      employee.address_postcode,
      employee.address_country
    ].filter(Boolean).join(', ') || employee.address || '—'
  };
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
  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .insert([payload])
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Leave request was created but no row was returned.');

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
    .eq('company_id', companyId);

  if (error) throw error;
  return (data || []).map(normaliseEmployee);
}

export async function getEmployeeByUserId(userId) {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    return {
      user_id: userId,
      display_name: 'Employee',
      employee_code: '—',
      employee_id: '—',
      job_title: '—',
      primary_email: '—',
      primary_phone: '—',
      address_full: '—'
    };
  }

  return normaliseEmployee(data);
}

export async function enrichRequestsWithEmployeeInfo(requests, companyId) {
  const employees = await getEmployeesByCompany(companyId);
  const employeeMap = new Map(employees.map((employee) => [employee.user_id, employee]));

  return requests.map((request) => {
    const employee = employeeMap.get(request.user_id);

    return {
      ...request,
      employee,
      employee_name: employee?.display_name || 'Employee',
      employee_id: employee?.employee_code || '—',
      employee_code: employee?.employee_code || '—',
      job_title: employee?.job_title || '—',
      employee_email: employee?.primary_email || '—'
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

  const isToday = (request) => request.start_date <= todayIso && request.end_date >= todayIso;

  const annualToday = approved.filter((r) => r.leave_type === 'annual' && isToday(r));
  const sickToday = approved.filter((r) => r.leave_type === 'sick' && isToday(r));
  const otherToday = approved.filter((r) => r.leave_type === 'other' && isToday(r));

  const annualNext7 = approved.filter((r) => r.leave_type === 'annual');
  const sickNext7 = approved.filter((r) => r.leave_type === 'sick');
  const otherNext7 = approved.filter((r) => r.leave_type === 'other');

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

export async function getEmployeeLeaveSummary(userId, year = new Date().getFullYear()) {
  const balance = await getMyLeaveBalance(userId, year);
  const { start, end } = getYearStartEnd(year);

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .select('*')
    .eq('user_id', userId)
    .gte('start_date', start)
    .lte('end_date', end)
    .order('start_date', { ascending: false });

  if (error) throw error;

  return {
    balance,
    requests: data || []
  };
}

export async function approveLeaveRequest(request, approverId) {
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      status: 'approved',
      approved_by: approverId,
      approved_at: nowIso
    })
    .eq('id', request.id);

  if (error) throw error;

  await supabase
    .schema(leaveSchema)
    .from('leave_logs')
    .insert([{
      leave_request_id: request.id,
      action: 'approved',
      performed_by: approverId,
      details: {
        previous_status: request.status,
        approved_at: nowIso
      }
    }]);

  if (request.leave_type === 'annual') {
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
    const { error: sickError } = await supabase
      .schema(leaveSchema)
      .from('sick_records')
      .insert([{
        user_id: request.user_id,
        company_id: request.company_id,
        leave_request_id: request.id,
        sick_date: request.start_date,
        notes: request.notes || request.reason || null
      }]);

    if (sickError) throw sickError;
  }

  return true;
}

export async function rejectLeaveRequest(requestId, approverId, notes) {
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      status: 'rejected',
      approved_by: approverId,
      approved_at: nowIso,
      notes: notes || null
    })
    .eq('id', requestId);

  if (error) throw error;

  await supabase
    .schema(leaveSchema)
    .from('leave_logs')
    .insert([{
      leave_request_id: requestId,
      action: 'rejected',
      performed_by: approverId,
      details: {
        rejected_at: nowIso,
        notes: notes || null
      }
    }]);

  return true;
}
