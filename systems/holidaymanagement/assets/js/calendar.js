import { requireAuth } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { renderEmptyState, escapeHtml } from '../../shared/ui.js';
import { formatDate, toIsoDate } from '../../shared/dates.js';
import * as api from '../../shared/api.js';

const departmentColours = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#ec4899', '#84cc16', '#f97316', '#06b6d4'];
const colourMap = new Map();
function deptColour(department = 'Unassigned') {
  const key = department || 'Unassigned';
  if (!colourMap.has(key)) colourMap.set(key, departmentColours[colourMap.size % departmentColours.length]);
  return colourMap.get(key);
}
function parseIso(iso) {
  const [y,m,d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function longDate(iso) {
  return new Intl.DateTimeFormat('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(parseIso(iso));
}
function monthRange(date) {
  return {
    start: toIsoDate(new Date(date.getFullYear(), date.getMonth(), 1)),
    end: toIsoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0))
  };
}
function eachDate(startIso, endIso, callback) {
  const d = parseIso(startIso);
  const end = parseIso(endIso);
  while (d <= end) {
    callback(toIsoDate(d));
    d.setDate(d.getDate() + 1);
  }
}

const ctx = await requireAuth();
if (ctx) {
  const { profile } = ctx;
  const grid = document.getElementById('calendarGrid');
  const monthLabel = document.getElementById('monthLabel');
  const selectedDateLabel = document.getElementById('selectedDateLabel');
  const selectedDateHeading = document.getElementById('selectedDateHeading');
  const datePicker = document.getElementById('calendarDatePicker');
  const departmentFilter = document.getElementById('departmentFilter');
  const departmentLegend = document.getElementById('departmentLegend');
  const selectedList = document.getElementById('selectedDateLeaveList');

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut();
    location.href = './login.html';
  });

  let selectedIso = toIsoDate(new Date());
  let monthDate = parseIso(selectedIso);
  let holidays = [];
  let department = 'all';
  let departments = [];

  async function loadDepartments() {
    departments = await api.getDepartments(profile.company_id).catch(() => []);
    departmentFilter.innerHTML = '<option value="all">All departments</option>' + departments.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    departmentLegend.innerHTML = departments.length
      ? departments.map(d => `<span class="department-legend-item"><span class="department-dot" style="background:${deptColour(d)};box-shadow:0 0 0 4px ${deptColour(d)}22"></span>${escapeHtml(d)}</span>`).join('')
      : '<span class="department-legend-item muted">No departments found yet.</span>';
  }

  async function buildCalendar() {
    const { start, end } = monthRange(monthDate);
    const overlap = await api.getLeaveOverlap(profile.company_id, start, end, department).catch(() => []);
    const dotsByDate = new Map();

    overlap.filter(r => r.status === 'approved').forEach(r => {
      const dept = r.employees?.department || 'Unassigned';
      eachDate(r.start_date, r.end_date, iso => {
        if (iso < start || iso > end) return;
        if (!dotsByDate.has(iso)) dotsByDate.set(iso, new Map());
        dotsByDate.get(iso).set(dept, deptColour(dept));
      });
    });

    const holidayByDate = new Map();
    holidays.forEach(h => {
      if (!holidayByDate.has(h.holiday_date)) holidayByDate.set(h.holiday_date, []);
      holidayByDate.get(h.holiday_date).push(h);
    });

    monthLabel.textContent = new Intl.DateTimeFormat('en-GB', { month:'long', year:'numeric' }).format(monthDate);
    selectedDateLabel.textContent = longDate(selectedIso);

    const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    let html = '';

    for (let i = 0; i < first.getDay(); i++) html += '<div class="calendar-cell calendar-empty"></div>';

    for (let day = 1; day <= daysInMonth; day++) {
      const iso = toIsoDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
      const dots = [...(dotsByDate.get(iso)?.entries() || [])];
      const holiday = holidayByDate.has(iso);
      html += `
        <button class="calendar-cell calendar-day ${iso === selectedIso ? 'active-calendar-day' : ''}" type="button" data-date="${iso}">
          <span class="calendar-day-number">${day}</span>
          <span class="calendar-day-dots">
            ${dots.map(([dept, colour]) => `<span class="calendar-day-dot" title="${escapeHtml(dept)}" style="background:${colour};box-shadow:0 0 0 4px ${colour}22"></span>`).join('')}
            ${holiday ? '<span class="calendar-holiday-dot" title="Holiday"></span>' : ''}
          </span>
        </button>`;
    }

    grid.innerHTML = html;
  }

  async function loadSelectedDate() {
    if (datePicker) datePicker.value = selectedIso;
    selectedDateLabel.textContent = longDate(selectedIso);
    selectedDateHeading.textContent = `Who Is Off On ${longDate(selectedIso)}`;

    const [rows, dayHolidays] = await Promise.all([
      api.getApprovedLeaveForDate(profile.company_id, selectedIso, department).catch(() => []),
      Promise.resolve(holidays.filter(h => h.holiday_date === selectedIso))
    ]);

    const holidayCards = dayHolidays.map(h => `
      <article class="leave-card holiday-calendar-card">
        <p class="leave-card-title">${escapeHtml(h.name || 'Holiday')}</p>
        <p class="leave-card-subtitle">${h.type === 'bank' ? 'Bank Holiday' : 'Company Holiday'} • ${formatDate(h.holiday_date)}</p>
      </article>`);

    const leaveCards = rows.map(r => {
      const dept = r.employees?.department || 'Unassigned';
      const colour = deptColour(dept);
      return `
        <article class="leave-card">
          <div class="leave-card-top">
            <div>
              <p class="leave-card-title">${escapeHtml(r.employees?.full_name || 'Employee')}</p>
              <p class="leave-card-subtitle">${escapeHtml(r.employees?.job_title || '—')}</p>
            </div>
            <span class="department-dot" title="${escapeHtml(dept)}" style="background:${colour};box-shadow:0 0 0 4px ${colour}22"></span>
          </div>
        </article>`;
    });

    const cards = [...holidayCards, ...leaveCards];
    if (!cards.length) renderEmptyState(selectedList, 'Nobody is off and there are no holidays on this date.');
    else selectedList.innerHTML = cards.join('');
  }

  async function reload() {
    await buildCalendar();
    await loadSelectedDate();
  }

  await loadDepartments();
  holidays = await api.getHolidays(profile.company_id).catch(() => []);

  departmentFilter.addEventListener('change', async () => {
    department = departmentFilter.value;
    await reload();
  });
  grid.addEventListener('click', async (event) => {
    const btn = event.target.closest('.calendar-day');
    if (!btn) return;
    selectedIso = btn.dataset.date;
    monthDate = parseIso(selectedIso);
    await reload();
  });
  document.getElementById('prevMonthBtn')?.addEventListener('click', async () => {
    monthDate = new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1);
    selectedIso = toIsoDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
    await reload();
  });
  document.getElementById('nextMonthBtn')?.addEventListener('click', async () => {
    monthDate = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1);
    selectedIso = toIsoDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
    await reload();
  });
  document.getElementById('findDateBtn')?.addEventListener('click', async () => {
    if (!datePicker.value) return;
    selectedIso = datePicker.value;
    monthDate = parseIso(selectedIso);
    await reload();
  });

  await reload();
}
