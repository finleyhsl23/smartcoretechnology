import { requireAuth } from '../../shared/guards.js';
import { createLeaveRequest, getMyEmployee, getAllHolidayDates } from '../../shared/api.js';
import { revealApp, showMessage, setLoadingButton, formatDate, escapeHtml } from '../../shared/ui.js';
import { countWorkingDays, toISODate } from '../../shared/dates.js';

let ctx, employee, holidays;

async function init() {
  ctx = await requireAuth();
  if (!ctx) return;

  const { session, company } = ctx;
  populateSidebar(company);

  [employee, holidays] = await Promise.all([
    getMyEmployee(session.user.id, company.id),
    getAllHolidayDates(company.id)
  ]);

  renderAllowance();
  renderUpcomingHolidays();
  revealApp();

  // Date change → recalculate days
  document.getElementById('startDate').addEventListener('change', recalcDays);
  document.getElementById('endDate').addEventListener('change', recalcDays);

  // Default start date to today
  document.getElementById('startDate').value = toISODate(new Date());
  document.getElementById('endDate').value = toISODate(new Date());
  recalcDays();

  document.getElementById('requestForm').addEventListener('submit', submitRequest);
}

function populateSidebar(company) {
  const initials = company.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('companyAvatar').textContent = initials;
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companyRole').textContent = company.role || 'Employee';
}

function renderAllowance() {
  const allowance = employee?.annual_leave_allowance ?? 28;
  const taken = employee?.leave_taken ?? 0;
  document.getElementById('allowanceVal').textContent = `${allowance} days`;
  document.getElementById('takenVal').textContent = `${taken} days`;
  document.getElementById('remainingVal').textContent = `${Math.max(0, allowance - taken)} days`;
}

function recalcDays() {
  const start = document.getElementById('startDate').value;
  const end = document.getElementById('endDate').value;
  if (!start || !end || end < start) {
    document.getElementById('daysDisplay').value = '';
    return;
  }
  const days = countWorkingDays(start, end, holidays);
  document.getElementById('daysDisplay').value = `${days} working day${days !== 1 ? 's' : ''}`;
}

function renderUpcomingHolidays() {
  const list = document.getElementById('upcomingHolidayList');
  const todayStr = toISODate(new Date());
  const upcoming = holidays.filter(h => h.date >= todayStr).slice(0, 6);
  if (!upcoming.length) {
    list.innerHTML = `<p class="muted small">No upcoming holidays.</p>`;
    return;
  }
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

  if (!startDate || !endDate) {
    showMessage('requestMsg', 'Please select start and end dates.', 'error');
    return;
  }
  if (endDate < startDate) {
    showMessage('requestMsg', 'End date cannot be before start date.', 'error');
    return;
  }

  const days = countWorkingDays(startDate, endDate, holidays);
  if (days <= 0) {
    showMessage('requestMsg', 'No working days in the selected range (check for bank holidays).', 'error');
    return;
  }

  // Check allowance for annual leave
  if (leaveType === 'annual') {
    const allowance = employee?.annual_leave_allowance ?? 28;
    const taken = employee?.leave_taken ?? 0;
    const remaining = allowance - taken;
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

init();
