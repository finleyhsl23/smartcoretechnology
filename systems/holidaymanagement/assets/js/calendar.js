import { requireAuth } from '../../shared/guards.js';
import { getLeaveRequestsByCompany, getAllHolidayDates, getEmployeesByCompany } from '../../shared/api.js';
import { revealApp, badgeClass, formatDate, escapeHtml } from '../../shared/ui.js';
import { monthName, daysInMonth, firstDayOfMonth, toISODate } from '../../shared/dates.js';

let ctx, approvedLeave = [], holidays = [], allEmployees = [];
let year = new Date().getFullYear();
let month = new Date().getMonth();
let activeDeptFilter = '';

async function init() {
  ctx = await requireAuth();
  if (!ctx) return;

  const { company } = ctx;
  populateSidebar(company);

  [approvedLeave, holidays, allEmployees] = await Promise.all([
    getLeaveRequestsByCompany(company.id, { status: 'approved' }),
    getAllHolidayDates(company.id),
    getEmployeesByCompany(company.id)
  ]);

  buildDeptFilter();
  renderCalendar();
  revealApp();

  document.getElementById('prevMonth').addEventListener('click', () => { month--; if (month < 0) { month = 11; year--; } renderCalendar(); });
  document.getElementById('nextMonth').addEventListener('click', () => { month++; if (month > 11) { month = 0; year++; } renderCalendar(); });
  document.getElementById('todayBtn').addEventListener('click', () => { year = new Date().getFullYear(); month = new Date().getMonth(); renderCalendar(); });
  document.getElementById('closeDayPanel').addEventListener('click', () => document.getElementById('dayPanel').classList.add('hidden'));

  document.getElementById('jumpDateInput').addEventListener('keydown', e => { if (e.key === 'Enter') jumpToDate(); });
  document.getElementById('jumpDateBtn').addEventListener('click', jumpToDate);

  document.getElementById('deptFilterSelect').addEventListener('change', e => {
    activeDeptFilter = e.target.value;
    renderCalendar();
  });
}

function buildDeptFilter() {
  const depts = [...new Set(allEmployees.map(e => e.department).filter(Boolean))].sort();
  const sel = document.getElementById('deptFilterSelect');
  depts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    sel.appendChild(opt);
  });
}

function jumpToDate() {
  const val = document.getElementById('jumpDateInput').value;
  if (!val) return;
  const d = new Date(val);
  if (isNaN(d)) return;
  year = d.getFullYear();
  month = d.getMonth();
  renderCalendar();
}

function populateSidebar(company) {
  const initials = company.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('companyAvatar').textContent = initials;
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companyRole').textContent = company.role || 'Employee';
}

function renderCalendar() {
  document.getElementById('calMonthLabel').textContent = `${monthName(month)} ${year}`;

  const grid = document.getElementById('calGrid');
  const days = daysInMonth(year, month);
  const firstDay = firstDayOfMonth(year, month);
  const todayStr = toISODate(new Date());

  const holidaySet = new Set(holidays.map(h => h.date));
  const holidayMap = {};
  holidays.forEach(h => { holidayMap[h.date] = h.name; });

  // Filter leave by dept
  const filteredLeave = activeDeptFilter
    ? approvedLeave.filter(r => r.employees?.department === activeDeptFilter)
    : approvedLeave;

  const leaveByDay = {};
  filteredLeave.forEach(r => {
    const start = new Date(r.start_date);
    const end = new Date(r.end_date);
    const cur = new Date(start);
    while (cur <= end) {
      const key = toISODate(cur);
      if (!leaveByDay[key]) leaveByDay[key] = [];
      leaveByDay[key].push(r);
      cur.setDate(cur.getDate() + 1);
    }
  });

  let html = '';
  for (let i = 0; i < firstDay; i++) html += `<div class="calendar-cell calendar-empty"></div>`;

  for (let d = 1; d <= days; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isHoliday = holidaySet.has(dateStr);
    const dayLeave = leaveByDay[dateStr] || [];

    const holiday = isHoliday ? `<div class="calendar-day-note">${escapeHtml(holidayMap[dateStr])}</div>` : '';
    const chips = dayLeave.slice(0, 3).map(r => {
      const name = r.employees?.full_name?.split(' ')[0] || '?';
      const colour = r.leave_type === 'sick' ? '#a86cff' : r.leave_type === 'other' ? '#9fb1c9' : '#2d7cff';
      return `<div class="dept-event" style="background:${colour}">${escapeHtml(name)}</div>`;
    }).join('');
    const more = dayLeave.length > 3 ? `<div class="dept-event" style="background:#6b7a8d">+${dayLeave.length - 3}</div>` : '';

    html += `
      <button class="calendar-cell calendar-day ${isToday ? 'today-calendar-day' : ''} ${isHoliday ? 'holiday-calendar-day' : ''} ${dayLeave.length ? 'active-calendar-day' : ''}"
        data-date="${dateStr}">
        <span class="calendar-day-number">${d}</span>
        ${holiday}
        ${chips}${more}
      </button>
    `;
  }

  grid.innerHTML = html;
  grid.querySelectorAll('[data-date]').forEach(cell => {
    cell.addEventListener('click', () => showDayPanel(cell.dataset.date));
  });
}

function showDayPanel(dateStr) {
  const panel = document.getElementById('dayPanel');
  const title = document.getElementById('dayPanelTitle');
  const content = document.getElementById('dayPanelContent');

  title.textContent = formatDate(dateStr, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const holiday = holidays.find(h => h.date === dateStr);
  const filteredLeave = activeDeptFilter
    ? approvedLeave.filter(r => r.employees?.department === activeDeptFilter)
    : approvedLeave;
  const dayLeave = filteredLeave.filter(r => r.start_date <= dateStr && r.end_date >= dateStr);

  let html = '';
  if (holiday) {
    html += `<div class="detail-tile" style="margin-bottom:12px">
      <span class="detail-label">Bank / Company Holiday</span>
      <span class="detail-value">${escapeHtml(holiday.name)}</span>
    </div>`;
  }

  if (dayLeave.length) {
    html += `<h3 style="margin:0 0 10px;font-size:1rem">On Leave (${dayLeave.length})</h3>`;
    html += dayLeave.map(r => `
      <div class="leave-card compact" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
          <div>
            <p style="margin:0;font-weight:700">${escapeHtml(r.employees?.full_name || '—')}</p>
            <p class="muted small" style="margin:4px 0 0">${escapeHtml(r.employees?.department || '')} · ${formatDate(r.start_date)} — ${formatDate(r.end_date)}</p>
          </div>
          <span class="${badgeClass(r.leave_type)}">${escapeHtml(r.leave_type || '')}</span>
        </div>
      </div>
    `).join('');
  }

  if (!html) html = `<p class="muted">No leave or holidays on this day.</p>`;

  content.innerHTML = html;
  panel.classList.remove('hidden');
}

init();
