import { supabase, leaveSchema } from './supabase.js';
import { addDays, isDateInRange, toIsoDate } from './dates.js';

async function getEmployeeNameMap(companyId) {
  const queries = [
    supabase.from('employees').select('user_id, full_name, first_name, last_name, dob, company_id').eq('company_id', companyId),
    supabase.from('employees').select('*').eq('company_id', companyId)
  ];

  for (const queryPromise of queries) {
    const { data, error } = await queryPromise;
    if (!error && data) {
      const map = new Map();
      data.forEach((row) => {
        const name = row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || row.name || row.email || 'Employee';
        if (row.user_id) map.set(row.user_id, { name, dob: row.dob || null, row });
      });
      return { rows: data, map };
    }
  }

  return { rows: [], map: new Map() };
}

function withNames(records, employeeMap) {
  return (records || []).map((item) => ({
    ...item,
    employee_name: employeeMap.get(item.user_id)?.name || item.employee_name || 'Employee'
  }));
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
    .single();

  if (error) throw error;

  await supabase.schema(leaveSchema).from('leave_logs').insert([{
    leave_request_id: data.id,
    action: 'created',
    performed_by: payload.user_id,
    details: {
      leave_type: payload.leave_type,
      start_date: payload.start_date,
      end_date: payload.end_date,
      total_days: payload.total_days,
      reason: payload.reason || null
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

  const { map } = await getEmployeeNameMap(companyId);
  return withNames(data || [], map);
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

  await supabase.schema(leaveSchema).from('leave_logs').insert([{
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
      await supabase.schema(leaveSchema).from('leave_balances').update({
        used_days: usedDays,
        remaining_days: remainingDays
      }).eq('id', balance.id);
    }
  }

  if (request.leave_type === 'sick') {
    await supabase.schema(leaveSchema).from('sick_records').insert([{
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

  await supabase.schema(leaveSchema).from('leave_logs').insert([{
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

export async function getDashboardLeaveBreakdown(companyId) {
  const requests = await getAllCompanyLeaveRequests(companyId);
  const today = toIsoDate();
  const next7End = addDays(today, 6);

  const approved = requests.filter((item) => item.status === 'approved');
  const split = (type) => {
    const typed = approved.filter((item) => item.leave_type === type);
    return {
      today: typed.filter((item) => isDateInRange(today, item.start_date, item.end_date)),
      next7: typed.filter((item) => item.start_date >= today && item.start_date <= next7End)
    };
  };

  return {
    annual: split('annual'),
    sick: split('sick'),
    other: split('other'),
    allRequests: requests
  };
}

export async function getUpcomingBirthdays(companyId) {
  const { rows, map } = await getEmployeeNameMap(companyId);
  const today = new Date();
  const upcoming = [];

  rows.forEach((row) => {
    if (!row.dob) return;
    const dob = new Date(row.dob);
    if (Number.isNaN(dob.getTime())) return;

    const nextBirthday = new Date(today.getFullYear(), dob.getMonth(), dob.getDate());
    if (nextBirthday < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      nextBirthday.setFullYear(today.getFullYear() + 1);
    }

    const diffDays = Math.floor((nextBirthday - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
    if (diffDays >= 0 && diffDays <= 6) {
      const name = row.full_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || map.get(row.user_id)?.name || 'Employee';
      upcoming.push({
        name,
        date: toIsoDate(nextBirthday),
        daysAway: diffDays
      });
    }
  });

  return upcoming.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getApprovedLeaveForDate(companyId, isoDate) {
  const requests = await getAllCompanyLeaveRequests(companyId);
  return requests.filter((item) => item.status === 'approved' && isDateInRange(isoDate, item.start_date, item.end_date));
}

export async function getApprovedLeaveForMonth(companyId) {
  const requests = await getAllCompanyLeaveRequests(companyId);
  return requests.filter((item) => item.status === 'approved');
}
