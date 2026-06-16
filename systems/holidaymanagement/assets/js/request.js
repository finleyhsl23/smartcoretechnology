import { requireAuth } from '../../shared/guards.js';
import { createLeaveRequest, getMyEmployee, getAllHolidayDates, getLeaveRequestsByCompany, getLeaveUsedThisYear } from '../../shared/api.js';
import { revealApp, showMessage, setLoadingButton, formatDate, escapeHtml, badgeClass } from '../../shared/ui.js';
import { countWorkingDays, toISODate } from '../../shared/dates.js';

let ctx, employee, holidays, whoOffData = [];
let leaveUsed = 0;

async function init() {
  ctx = await requireAuth();
  if (!ctx) return;

  const { session, company } = ctx;
  populateSidebar(company);

  [employee, holidays] = await Promise.all([
    getMyEmployee(session.user.id, company.id),
    getAllHolidayDates(company.id)
  ]);

  if (employee) leaveUsed = await getLeaveUsedThisYear(employee.id, company.id);

  renderAllowance();
  renderUpcomingHolidays();
  revealApp();

  document.getElementById('startDate').addEventListener('change', recalcDays);
  document.getElementById('endDate').addEventListener('change', recalcDays);
  document.getElementById('startDate').value = toISODate(new Date());
  document.getElementById('endDate').value = toISODate(new Date());
  recalcDays();

  document.getElementById('requestForm').addEventListener('submit', submitRequest);

  document.getElementById('whoOffBtn').addEventListener('click', openWhoOff);
  document.getElementById('closeWhoOffModal').addEventListener('click', () => document.getElementById('whoOffModal').classList.add('hidden'));
  document.getElementById('whoOffSearch').addEventListener('input', renderWhoOff);
  document.getElementById('whoOffDept').addEventListener('change', renderWhoOff);
  document.getElementById('whoOffPeriod').addEventListener('change', renderWhoOff);
}

function populateSidebar(company) {
  const initials = company.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('companyAvatar').textContent = initials;
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companyRole').textContent = company.role || 'Employee';
}

function renderAllowance() {
  const allowance = employee?.annual_leave_allowance ?? 28;
  const remaining = Math.max(0, allowance - leaveUsed);
  document.getElementById('allowanceVal').textContent = `${allowance} days`;
  document.getElementById('takenVal').textContent = `${leaveUsed} days`;
  document.getElementById('remainingVal').textContent = `${remaining} days`;
}

function recalcDays() {
  const start = document.getElementById('startDate').value;
  const end = document.getElementById('endDate').value;
  if (!start || !end || end < start) { document.getElementById('daysDisplay').value = ''; return; }
  const days = countWorkingDays(start, end, holidays);
  document.getElementById('daysDisplay').value = `${days} working day${days !== 1 ? 's' : ''}`;
}

function renderUpcomingHolidays() {
  const list = document.getElementById('upcomingHolidayList');
  const todayStr = toISODate(new Date());
  const upcoming = holidays.filter(h => h.date >= todayStr).slice(0, 6);
  if (!upcoming.length) { list.innerHTML = `<p class="muted small">No upcoming holidays.</p>`; return; }
  list.innerHTML = upcoming.map(h => `
    <div class="mini-list-row">
      <span class="small">${escapeHtml(h.name)}</span>
      <span class="muted small">${formatDate(h.date)}</span>
    </div>
  `).join('');
}

async function submitRequest(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const leaveType = document.getElementById('leaveType').value;
  const startDate = document.getElementById('startDate').value;
  const endDate = document.getElementById('endDate').value;
  const notes = document.getElementById('notes').value.trim();

  if (!startDate || !endDate) { showMessage('requestMsg', 'Please select start and end dates.', 'error'); return; }
  if (endDate < startDate) { showMessage('requestMsg', 'End date cannot be before start date.', 'error'); return; }

  const days = countWorkingDays(startDate, endDate, holidays);
  if (days <= 0) { showMessage('requestMsg', 'No working days in the selected range (check for bank holidays).', 'error'); return; }

  if (leaveType === 'annual') {
    const allowance = employee?.annual_leave_allowance ?? 28;
    const remaining = allowance - leaveUsed;
    if (days > remaining) {
      showMessage('requestMsg', `You only have ${remaining} days remaining. This request requires ${days} days.`, 'error');
      return;
    }
  }

  setLoadingButton(btn, true, 'Submitting...');
  showMessage('requestMsg', '', 'info');

  const isOwner = ['owner'].includes(String(ctx.company.role || '').toLowerCase());

  try {
    await createLeaveRequest({
      company_id: ctx.company.id,
      employee_id: employee.id,
      user_id: ctx.session.user.id,
      leave_type: leaveType,
      start_date: startDate,
      end_date: endDate,
      days_requested: days,
      notes,
      is_owner: isOwner,
      employee_name: employee.full_name,
      company_name: ctx.company.name
    });
    window.location.href = '/systems/holidaymanagement/my-leave.html';
  } catch (err) {
    showMessage('requestMsg', err.message, 'error');
    setLoadingButton(btn, false);
  }
}

// ── Who's off modal ──────────────────────────────────────────────

async function openWhoOff() {
  document.getElementById('whoOffModal').classList.remove('hidden');
  if (!whoOffData.length) {
    whoOffData = await getLeaveRequestsByCompany(ctx.company.id, { status: 'approved' });
  }
  const depts = [...new Set(whoOffData.map(r => r.employees?.department).filter(Boolean))].sort();
  const sel = document.getElementById('whoOffDept');
  sel.innerHTML = '<option value="">All Departments</option>';
  depts.forEach(d => { sel.innerHTML += `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`; });
  renderWhoOff();
}

function renderWhoOff() {
  const search = document.getElementById('whoOffSearch').value.toLowerCase();
  const dept = document.getElementById('whoOffDept').value;
  const period = document.getElementById('whoOffPeriod').value;
  const todayStr = new Date().toISOString().split('T')[0];
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);
  const in30Str = in30.toISOString().split('T')[0];

  let filtered = whoOffData;
  if (period === 'current') filtered = filtered.filter(r => r.start_date <= todayStr && r.end_date >= todayStr);
  else if (period === 'upcoming') filtered = filtered.filter(r => r.start_date > todayStr && r.start_date <= in30Str);
  if (dept) filtered = filtered.filter(r => r.employees?.department === dept);
  if (search) filtered = filtered.filter(r =>
    r.employees?.full_name?.toLowerCase().includes(search) ||
    r.employees?.department?.toLowerCase().includes(search)
  );

  const list = document.getElementById('whoOffList');
  if (!filtered.length) { list.innerHTML = `<p class="muted">No one found for this filter.</p>`; return; }

  list.innerHTML = filtered.map(r => `
    <div class="leave-card compact" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <p style="margin:0;font-weight:700">${escapeHtml(r.employees?.full_name || '—')}</p>
          <p class="muted small" style="margin:4px 0 0">${escapeHtml(r.employees?.department || 'No dept')} &middot; ${formatDate(r.start_date)} — ${formatDate(r.end_date)}</p>
        </div>
        <span class="${badgeClass(r.leave_type)}">${escapeHtml(r.leave_type || '')}</span>
      </div>
    </div>
  `).join('');
}

init();
