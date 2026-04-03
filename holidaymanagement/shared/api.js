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
    .single();

  if (error) throw error;

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
    .select('*, user:users!leave_requests_user_id_fkey(full_name, email)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (error) {
    const fallback = await supabase
      .schema(leaveSchema)
      .from('leave_requests')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (fallback.error) throw fallback.error;
    return fallback.data || [];
  }

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

export async function approveLeaveRequest(request, approverId) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      status: 'approved',
      approved_by: approverId,
      approved_at: nowIso
    })
    .eq('id', request.id)
    .select()
    .single();

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

      await supabase
        .schema(leaveSchema)
        .from('leave_balances')
        .update({
          used_days: usedDays,
          remaining_days: remainingDays
        })
        .eq('id', balance.id);
    }
  }

  if (request.leave_type === 'sick') {
    await supabase
      .schema(leaveSchema)
      .from('sick_records')
      .insert([{
        user_id: request.user_id,
        company_id: request.company_id,
        leave_request_id: request.id,
        sick_date: request.start_date,
        notes: request.notes || request.reason || null,
        created_by: approverId
      }]);
  }

  return data;
}

export async function rejectLeaveRequest(requestId, approverId, notes) {
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .schema(leaveSchema)
    .from('leave_requests')
    .update({
      status: 'rejected',
      approved_by: approverId,
      approved_at: nowIso,
      notes: notes || null
    })
    .eq('id', requestId)
    .select()
    .single();

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

  return data;
}
