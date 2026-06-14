// SmartCore Holiday Management — Database API Layer

// ── Companies ────────────────────────────────────────────────
const Companies = {
  async get(id) {
    const { data, error } = await getSupabase().from('companies').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },
  async update(id, fields) {
    const { data, error } = await getSupabase().from('companies').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async getAll() {
    const { data, error } = await getSupabase().from('companies').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },
};

// ── Employees ─────────────────────────────────────────────────
const Employees = {
  async list(companyId, opts = {}) {
    let q = getSupabase()
      .from('employees')
      .select('*')
      .eq('company_id', companyId)
      .order('full_name');
    if (opts.status) q = q.eq('employment_status', opts.status);
    if (opts.department) q = q.eq('department', opts.department);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async get(id) {
    const { data, error } = await getSupabase()
      .from('employees').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async getByUserId(userId, companyId) {
    const { data, error } = await getSupabase()
      .from('employees').select('*')
      .eq('user_id', userId).eq('company_id', companyId).single();
    if (error) return null;
    return data;
  },

  async update(id, fields) {
    const { data, error } = await getSupabase()
      .from('employees').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async getDepartments(companyId) {
    const { data, error } = await getSupabase()
      .from('employees')
      .select('department')
      .eq('company_id', companyId)
      .not('department', 'is', null);
    if (error) return [];
    const depts = [...new Set(data.map(r => r.department).filter(Boolean))].sort();
    return depts;
  },

  async getAdmins(companyId) {
    const { data, error } = await getSupabase()
      .from('employees')
      .select('id, full_name, job_title, role')
      .eq('company_id', companyId)
      .in('role', ['owner', 'admin'])
      .eq('employment_status', 'active');
    if (error) throw error;
    return data;
  },

  async calculateEntitlement(allowance, startDate, yearStartMonth, yearStartDay) {
    if (!startDate) return allowance;
    const today = new Date();
    const start = new Date(startDate);
    // If started before this leave year, full allowance
    const thisYearStart = new Date(today.getFullYear(), (yearStartMonth || 1) - 1, yearStartDay || 1);
    if (start <= thisYearStart) return allowance;
    // Prorate
    const yearEnd = new Date(thisYearStart);
    yearEnd.setFullYear(yearEnd.getFullYear() + 1);
    const remainingMs = yearEnd - start;
    const yearMs = yearEnd - thisYearStart;
    if (remainingMs <= 0) return 0;
    const raw = allowance * (remainingMs / yearMs);
    return roundHalf(raw);
  },
};

// ── Leave Requests ────────────────────────────────────────────
const LeaveRequests = {
  async list(companyId, opts = {}) {
    let q = getSupabase()
      .from('leave_requests')
      .select('*, employees(full_name, job_title, department, shift_pattern_id, avatar_url)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (opts.status)     q = q.eq('status', opts.status);
    if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
    if (opts.userId)     q = q.eq('user_id', opts.userId);
    if (opts.from)       q = q.gte('start_date', opts.from);
    if (opts.to)         q = q.lte('end_date', opts.to);
    if (opts.limit)      q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async get(id) {
    const { data, error } = await getSupabase()
      .from('leave_requests').select('*, employees(*)').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async create(payload) {
    const { data, error } = await getSupabase()
      .from('leave_requests').insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async update(id, fields) {
    const { data, error } = await getSupabase()
      .from('leave_requests').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async getForDate(companyId, date) {
    const { data, error } = await getSupabase()
      .from('leave_requests')
      .select('*, employees(full_name, job_title, department)')
      .eq('company_id', companyId)
      .eq('status', 'approved')
      .lte('start_date', date)
      .gte('end_date', date);
    if (error) throw error;
    return data;
  },

  async getForMonth(companyId, year, month) {
    const from = `${year}-${String(month).padStart(2,'0')}-01`;
    const to   = `${year}-${String(month).padStart(2,'0')}-31`;
    const { data, error } = await getSupabase()
      .from('leave_requests')
      .select('*, employees(full_name, job_title, department)')
      .eq('company_id', companyId)
      .eq('status', 'approved')
      .or(`start_date.lte.${to},end_date.gte.${from}`);
    if (error) throw error;
    return data;
  },
};

// ── Leave Balances ────────────────────────────────────────────
const LeaveBalances = {
  async get(employeeId, year) {
    const { data } = await getSupabase()
      .from('leave_balances')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('year', year)
      .single();
    return data;
  },

  async sync(employeeId) {
    const { error } = await getSupabase().rpc('sync_employee_balance', { p_employee_id: employeeId });
    if (error) throw error;
  },
};

// ── Shift Patterns ────────────────────────────────────────────
const ShiftPatterns = {
  async list(companyId) {
    const { data, error } = await getSupabase()
      .from('shift_patterns').select('*').eq('company_id', companyId).order('name');
    if (error) throw error;
    return data;
  },

  async get(id) {
    const { data, error } = await getSupabase()
      .from('shift_patterns').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async create(payload) {
    const { data, error } = await getSupabase()
      .from('shift_patterns').insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async update(id, fields) {
    const { data, error } = await getSupabase()
      .from('shift_patterns').update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await getSupabase().from('shift_patterns').delete().eq('id', id);
    if (error) throw error;
  },
};

// ── Holidays ──────────────────────────────────────────────────
const Holidays = {
  async getCompanyHolidays(companyId, year) {
    let q = getSupabase().from('company_holidays').select('*').eq('company_id', companyId).order('holiday_date');
    if (year) {
      q = q.gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async getBankHolidays(region, year) {
    let q = getSupabase().from('bank_holidays').select('*').eq('region', region).order('holiday_date');
    if (year) q = q.gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async addCompanyHoliday(payload) {
    const { data, error } = await getSupabase()
      .from('company_holidays').insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async deleteCompanyHoliday(id) {
    const { error } = await getSupabase().from('company_holidays').delete().eq('id', id);
    if (error) throw error;
  },
};

// ── Onboarding Invites ────────────────────────────────────────
const Invites = {
  async getByToken(token) {
    const { data, error } = await getSupabase()
      .from('onboarding_invites')
      .select('*, companies(company_name, display_name, logo_url)')
      .eq('token', token)
      .single();
    if (error) return null;
    return data;
  },

  async markUsed(id) {
    const { error } = await getSupabase()
      .from('onboarding_invites')
      .update({ status: 'used', used_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};

// ── Audit Log ────────────────────────────────────────────────
const AuditLog = {
  async write(companyId, actorUserId, action, entityType, entityId, details = {}) {
    await getSupabase().from('audit_logs').insert({
      company_id: companyId,
      actor_user_id: actorUserId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    });
  },
};

// ── Helpers ──────────────────────────────────────────────────
function roundHalf(n) {
  return Math.round(n * 2) / 2;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function daysBetween(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
}

function currentYear() {
  return new Date().getFullYear();
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarBg(name) {
  const colours = ['#3b82f6','#22c55e','#a855f7','#f59e0b','#06b6d4','#ec4899','#ef4444'];
  if (!name) return colours[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return colours[Math.abs(h) % colours.length];
}

// Call a Cloudflare Function
async function callAPI(path, body, method = 'POST') {
  const session = await getSession();
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed: ${res.status}`);
  return json;
}
