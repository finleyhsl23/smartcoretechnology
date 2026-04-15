import { supabase, leaveSchema } from './supabase.js';

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

  if (data?.id) {
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
  }

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

export async function getEmployeesByUserIds(userIds) {
  if (!userIds.length) return [];

  const { data, error } = await supabase
    .from('employees')
    .select('user_id, full_name, first_name, last_name, employee_id, job_title, dob')
    .in('user_id', userIds);

  if (error) throw error;
  return data || [];
}

export async function getLeaveBalancesForUsers(userIds, year) {
  if (!userIds.length) return [];

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_balances')
    .select('user_id, total_allowance, used_days, remaining_days, year')
    .eq('year', year)
    .in('user_id', userIds);

  if (error) throw error;
  return data || [];
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
      const remainingDays = Number(balance.total_allowance || 0) - usedDays;

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
