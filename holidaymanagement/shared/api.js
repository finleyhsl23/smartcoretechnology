import { supabase, leaveSchema } from './supabase.js';

export function leaveTypeLabel(value) {
  if (value === 'annual') return 'Annual Request';
  if (value === 'sick') return 'Sick Leave';
  return 'Other Leave';
}

export async function getEmployeesByCompany() {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .rpc('get_employees');

  if (error) throw error;

  return (data || []).map((employee) => ({
    ...employee,
    display_name: employee.full_name || 'Employee',
    employee_id_display: employee.employee_code || '—'
  }));
}

export async function searchEmployees(companyId, searchTerm) {
  const employees = await getEmployeesByCompany(companyId);
  const term = String(searchTerm || '').toLowerCase();

  return employees
    .filter((employee) =>
      JSON.stringify(employee).toLowerCase().includes(term)
    )
    .slice(0, 10);
}

export async function upsertEmployee(payload) {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .rpc('upsert_employee', {
      payload
    });

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
  const employees = await getEmployeesByCompany();
  return employees.find((employee) => employee.user_id === userId) || null;
}

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

export async function enrichRequestsWithEmployeeInfo(requests) {
  const employees = await getEmployeesByCompany();
  const byEmployeeId = new Map(employees.map((employee) => [employee.id, employee]));
  const byUserId = new Map(employees.filter((employee) => employee.user_id).map((employee) => [employee.user_id, employee]));

  return (requests || []).map((request) => {
    const employee =
      byEmployeeId.get(request.employee_id) ||
      byUserId.get(request.user_id);

    return {
      ...request,
      employee,
      employee_name: employee?.full_name || 'Employee',
      employee_id_display: employee?.employee_code || '—',
      job_title: employee?.job_title || '—'
    };
  });
}

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
  return data;
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

  if (deductAllowance && ['annual', 'other'].includes(request.leave_type) && request.user_id) {
    const balance = await getMyLeaveBalance(request.user_id, new Date(request.start_date).getFullYear());

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

  return true;
}
