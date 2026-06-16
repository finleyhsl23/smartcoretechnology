import { supabase, db } from './supabase.js';

// ── Companies ──────────────────────────────────────────────────────────────

export async function getCompaniesForUser(userId) {
  const { data, error } = await db
    .from('company_users')
    .select('company_id, role, employee_id, companies(id, company_name, logo_url), employees(is_admin)')
    .eq('user_id', userId)
    .in('status', ['active', 'invited']);
  if (error) throw error;
  return (data || []).map(row => ({
    id: row.company_id,
    name: row.companies?.company_name || '',
    logo_url: row.companies?.logo_url || null,
    role: row.role,
    is_admin: row.employees?.is_admin || false,
    employee_id: row.employee_id
  }));
}

export async function getCompany(companyId) {
  const { data, error } = await db
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateCompany(companyId, payload) {
  const { data, error } = await db
    .from('companies')
    .update(payload)
    .eq('id', companyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Departments ───────────────────────────────────────────────────────────

export async function getDepartments(companyId) {
  const { data } = await db
    .from('departments')
    .select('*')
    .eq('company_id', companyId)
    .order('name');
  return data || [];
}

export async function createDepartment(companyId, name) {
  const { data, error } = await db
    .from('departments')
    .insert({ company_id: companyId, name })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteDepartment(id, companyId) {
  const { error } = await db
    .from('departments')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) throw error;
}

// ── Employees ─────────────────────────────────────────────────────────────

export async function getEmployeesByCompany(companyId) {
  const { data, error } = await db
    .from('employees')
    .select('*')
    .eq('company_id', companyId)
    .order('full_name');
  if (error) throw error;
  return data || [];
}

export async function getEmployee(employeeId, companyId) {
  const { data, error } = await db
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .eq('company_id', companyId)
    .single();
  if (error) throw error;
  return data;
}

export async function getMyEmployee(userId, companyId) {
  const { data, error } = await db
    .from('employees')
    .select('*')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateEmployee(employeeId, companyId, payload) {
  const { data, error } = await db
    .from('employees')
    .update(payload)
    .eq('id', employeeId)
    .eq('company_id', companyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deactivateEmployee(employeeId, companyId) {
  return updateEmployee(employeeId, companyId, { employment_status: 'archived' });
}

export async function reactivateEmployee(employeeId, companyId) {
  return updateEmployee(employeeId, companyId, { employment_status: 'active' });
}

export async function deleteEmployee(employeeId, companyId) {
  await db.from('leave_requests').delete().eq('employee_id', employeeId).eq('company_id', companyId);
  await db.from('leave_balances').delete().eq('employee_id', employeeId);
  await db.from('company_users').delete().eq('employee_id', employeeId);
  const { error } = await db.from('employees').delete().eq('id', employeeId).eq('company_id', companyId);
  if (error) throw error;
}

export async function getLeaveUsedThisYear(employeeId, companyId) {
  const year = new Date().getFullYear();
  const { data } = await db
    .from('leave_requests')
    .select('total_days')
    .eq('employee_id', employeeId)
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .eq('leave_type', 'annual')
    .gte('start_date', `${year}-01-01`)
    .lte('start_date', `${year}-12-31`);
  return (data || []).reduce((s, r) => s + (r.total_days || 0), 0);
}

// ── Leave Requests ────────────────────────────────────────────────────────

export async function getLeaveRequestsByCompany(companyId, filters = {}) {
  let q = db
    .from('leave_requests')
    .select('*, employees(full_name, department, role, annual_leave_allowance, employment_status)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (filters.status) q = q.eq('status', filters.status);
  if (filters.employee_id) q = q.eq('employee_id', filters.employee_id);
  if (filters.type) q = q.eq('leave_type', filters.type);
  if (filters.from) q = q.gte('start_date', filters.from);
  if (filters.to) q = q.lte('end_date', filters.to);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getMyLeaveRequests(userId, companyId, filters = {}) {
  let q = db
    .from('leave_requests')
    .select('*')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (filters.status) q = q.eq('status', filters.status);
  if (filters.type) q = q.eq('leave_type', filters.type);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getLeaveRequest(requestId, companyId) {
  const { data, error } = await db
    .from('leave_requests')
    .select('*, employees(full_name, department, role, work_email, annual_leave_allowance)')
    .eq('id', requestId)
    .eq('company_id', companyId)
    .single();
  if (error) throw error;
  return data;
}

export async function createLeaveRequest(payload) {
  const status = payload.is_owner ? 'approved' : 'pending';
  const insertPayload = {
    company_id: payload.company_id,
    employee_id: payload.employee_id,
    user_id: payload.user_id,
    leave_type: payload.leave_type,
    start_date: payload.start_date,
    end_date: payload.end_date,
    total_days: payload.days_requested,
    notes: payload.notes || null,
    status
  };

  const { data, error } = await db
    .from('leave_requests')
    .insert(insertPayload)
    .select()
    .single();
  if (error) throw error;

  if (status === 'pending') {
    await notifyLeaveRequest(data, payload.employee_name, payload.company_name).catch(() => {});
  }

  return data;
}

export async function addLeaveAdmin(payload) {
  const { data, error } = await db
    .from('leave_requests')
    .insert({
      company_id: payload.company_id,
      employee_id: payload.employee_id,
      user_id: payload.user_id || null,
      leave_type: payload.leave_type,
      start_date: payload.start_date,
      end_date: payload.end_date,
      total_days: payload.total_days,
      notes: payload.notes || null,
      status: 'approved',
      approved_by: payload.approved_by,
      approved_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function approveLeaveRequest(request, approverId, note = '', deductAllowance = true) {
  const { data, error } = await db
    .from('leave_requests')
    .update({ status: 'approved', approved_by: approverId, approved_at: new Date().toISOString(), notes: note || null, updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('company_id', request.company_id)
    .select()
    .single();
  if (error) throw error;
  await notifyLeaveDecision(data, 'approved', note).catch(() => {});
  return data;
}

export async function rejectLeaveRequest(request, approverId, note = '') {
  const { data, error } = await db
    .from('leave_requests')
    .update({ status: 'rejected', rejected_by: approverId, rejected_at: new Date().toISOString(), notes: note || null, updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('company_id', request.company_id)
    .select()
    .single();
  if (error) throw error;
  await notifyLeaveDecision(data, 'rejected', note).catch(() => {});
  return data;
}

export async function cancelLeaveRequest(requestId, companyId, userId) {
  const { data, error } = await db
    .from('leave_requests')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: userId, updated_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function requestLeaveCancellation(request, userId, reason = '') {
  const { data, error } = await db
    .from('leave_requests')
    .update({ status: 'cancellation_requested', cancellation_requested_at: new Date().toISOString(), cancellation_requested_by: userId, cancellation_reason: reason || null, updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('company_id', request.company_id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  await notifyCancelRequest(data, reason).catch(() => {});
  return data;
}

export async function cancelLeaveRequestAdmin(request, adminId, reason = '') {
  const { data, error } = await db
    .from('leave_requests')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: adminId, cancel_admin_reason: reason || null, updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('company_id', request.company_id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function amendLeaveRequestAdmin(request, adminId, payload) {
  const { data, error } = await db
    .from('leave_requests')
    .update({ ...payload, amended_by: adminId, amended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', request.id)
    .eq('company_id', request.company_id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Holidays ──────────────────────────────────────────────────────────────

export async function getCompanyHolidays(companyId) {
  const { data, error } = await db
    .from('company_holidays')
    .select('*')
    .eq('company_id', companyId)
    .order('holiday_date');
  if (error) throw error;
  return data || [];
}

export async function addCompanyHoliday(companyId, payload) {
  const { data, error } = await db
    .from('company_holidays')
    .insert({ company_id: companyId, ...payload })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCompanyHoliday(id, companyId) {
  const { error } = await db
    .from('company_holidays')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) throw error;
}

export async function syncBankHolidays(companyId, country_codes) {
  const res = await fetch('/holidaymanagement/bank-holidays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company_id: companyId, country_codes })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getAllHolidayDates(companyId) {
  const holidays = await getCompanyHolidays(companyId);
  return holidays.map(h => ({ date: h.holiday_date, name: h.name, source: h.type || 'company' }));
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export async function getDashboardData(companyId, userId) {
  const todayStr = new Date().toISOString().split('T')[0];
  const in7 = new Date(); in7.setDate(in7.getDate() + 7);
  const in7Str = in7.toISOString().split('T')[0];

  const [allRequests, allEmployees, holidays] = await Promise.all([
    getLeaveRequestsByCompany(companyId),
    getEmployeesByCompany(companyId),
    getCompanyHolidays(companyId)
  ]);

  const onLeaveToday = allRequests.filter(r =>
    r.status === 'approved' && r.start_date <= todayStr && r.end_date >= todayStr
  );

  const upcomingLeave = allRequests.filter(r =>
    r.status === 'approved' && r.start_date > todayStr && r.start_date <= in7Str
  );

  const pendingRequests = allRequests.filter(r => r.status === 'pending');

  const todayHoliday = holidays.find(h => h.holiday_date === todayStr);

  const now = new Date();
  const birthdays = allEmployees.filter(e => {
    if (!e.dob) return false;
    const dob = new Date(e.dob);
    const thisYear = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
    const diff = thisYear - now;
    return diff >= 0 && diff <= 30 * 86400000;
  }).map(e => {
    const dob = new Date(e.dob);
    const next = new Date(now.getFullYear(), dob.getMonth(), dob.getDate());
    return { ...e, days_until: Math.round((next - now) / 86400000) };
  }).sort((a, b) => a.days_until - b.days_until);

  const anniversaries = allEmployees.filter(e => {
    if (!e.start_date) return false;
    const start = new Date(e.start_date);
    const thisYear = new Date(now.getFullYear(), start.getMonth(), start.getDate());
    const diff = thisYear - now;
    return diff >= 0 && diff <= 30 * 86400000;
  }).map(e => {
    const start = new Date(e.start_date);
    const next = new Date(now.getFullYear(), start.getMonth(), start.getDate());
    const years = now.getFullYear() - start.getFullYear();
    return { ...e, days_until: Math.round((next - now) / 86400000), years };
  }).sort((a, b) => a.days_until - b.days_until);

  const cancelRequests = allRequests.filter(r => r.status === 'cancellation_requested');

  return {
    onLeaveToday,
    upcomingLeave,
    pendingRequests,
    cancelRequests,
    todayHoliday,
    birthdays,
    anniversaries,
    totalEmployees: allEmployees.length,
    activeEmployees: allEmployees.filter(e => e.employment_status === 'active').length
  };
}

// ── Shift patterns ────────────────────────────────────────────────────────

export async function getShiftPatterns(companyId) {
  const { data, error } = await db
    .from('shift_patterns')
    .select('*')
    .eq('company_id', companyId)
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function createShiftPattern(companyId, payload) {
  const { data, error } = await db
    .from('shift_patterns')
    .insert({ company_id: companyId, ...payload })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateShiftPattern(id, companyId, payload) {
  const { data, error } = await db
    .from('shift_patterns')
    .update(payload)
    .eq('id', id)
    .eq('company_id', companyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteShiftPattern(id, companyId) {
  const { error } = await db
    .from('shift_patterns')
    .delete()
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) throw error;
}

// ── SmartCore admin ───────────────────────────────────────────────────────

export async function isSmartCoreAdmin(userId) {
  const { data } = await db
    .from('smartcore_admins')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

export async function getAllCompanies() {
  const { data, error } = await db
    .from('companies')
    .select('*')
    .order('company_name');
  if (error) throw error;
  return data || [];
}

export async function createCompany(payload) {
  const { data, error } = await db
    .from('companies')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getEmployeesByCompanyAdmin(companyId) {
  const { data, error } = await db
    .from('employees')
    .select('id, full_name, email, role, employment_status')
    .eq('company_id', companyId)
    .order('full_name');
  if (error) throw error;
  return data || [];
}

// ── Invites ───────────────────────────────────────────────────────────────

export async function sendEmployeeInvite(payload) {
  const res = await fetch('/holidaymanagement/send-invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to send invite');
  }
  return res.json();
}

export async function getOnboardingInvite(token) {
  const { data, error } = await db
    .from('onboarding_invites')
    .select('*, companies(company_name)')
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function completeEmployeeOnboarding(payload) {
  const res = await fetch('/holidaymanagement/complete-onboarding', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to complete onboarding');
  }
  return res.json();
}

// ── Internal notifications ────────────────────────────────────────────────

async function notifyLeaveRequest(request, employeeName, companyName) {
  return fetch('/holidaymanagement/leave-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'new_request', request, employee_name: employeeName, company_name: companyName })
  });
}

async function notifyLeaveDecision(request, decision, note) {
  return fetch('/holidaymanagement/leave-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'decision', request, decision, note })
  });
}

async function notifyCancelRequest(request, reason) {
  return fetch('/holidaymanagement/leave-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'cancel_request', request, reason })
  });
}
