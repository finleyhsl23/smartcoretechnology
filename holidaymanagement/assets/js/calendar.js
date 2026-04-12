import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, badgeClass, showPageError } from '../../shared/ui.js';
import { getApprovedLeaveForDate, getApprovedLeaveForMonth } from '../../shared/api.js';
import { getMonthMatrix, toIsoDate, formatDate } from '../../shared/dates.js';

function getCountMap(items) {
  const map = new Map();
  items.forEach((item) => {
    let current = new Date(item.start_date);
    const end = new Date(item.end_date);
    while (current <= end) {
      const iso = toIsoDate(current);
      map.set(iso, (map.get(iso) || 0) + 1);
      current.setDate(current.getDate() + 1);
    }
  });
  return map;
}

async function initCalendar() {
  try {
    const auth = await requireAuth();
    if (!auth) return;
    const { profile } = auth;
    applyRoleUi(profile);

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    const picker = document.getElementById('calendarDatePicker');
    const grid = document.getElementById('calendarGrid');
    const list = document.getElementById('selectedDateLeaveList');
    const heading = document.getElementById('selectedDateHeading');

    let selectedDate = toIsoDate();
    picker.value = selectedDate;

    const monthRequests = await getApprovedLeaveForMonth(profile.company_id);
    const countMap = getCountMap(monthRequests);

    async function renderSelectedDate() {
      const items = await getApprovedLeaveForDate(profile.company_id, selectedDate);
      heading.textContent = `Who Is Off • ${formatDate(selectedDate)}`;

      if (!items.length) {
        renderEmptyState(list, 'Nobody is off on this date.');
        return;
      }

      list.innerHTML = items.map((item) => `
        <article class="leave-card">
          <div class="leave-card-top">
            <div>
              <p class="leave-card-title">${item.employee_name || 'Employee'}</p>
              <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)}</p>
            </div>
            <div class="${badgeClass(item.leave_type)}">${item.leave_type}</div>
          </div>
          <div class="leave-card-bottom">
            <p class="leave-card-subtitle">${item.reason || 'No reason provided'}</p>
            <div class="${badgeClass(item.status)}">${item.status}</div>
          </div>
        </article>
      `).join('');
    }

    function renderCalendar() {
      const baseDate = new Date(selectedDate);
      const monthDays = getMonthMatrix(baseDate);
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

      grid.innerHTML = dayNames.map((name) => `<div class="calendar-day-name">${name}</div>`).join('') +
        monthDays.map((item) => `
          <button type="button" class="calendar-day ${item.inMonth ? '' : 'is-outside-month'} ${item.iso === selectedDate ? 'is-selected' : ''}" data-date="${item.iso}">
            <span>${item.day}</span>
            <span class="calendar-day-count">${countMap.get(item.iso) || 0} off</span>
          </button>
        `).join('');
    }

    grid.addEventListener('click', async (event) => {
      const button = event.target.closest('.calendar-day');
      if (!button) return;
      selectedDate = button.dataset.date;
      picker.value = selectedDate;
      renderCalendar();
      await renderSelectedDate();
    });

    picker.addEventListener('change', async () => {
      selectedDate = picker.value;
      renderCalendar();
      await renderSelectedDate();
    });

    renderCalendar();
    await renderSelectedDate();
    revealApp();
  } catch (error) {
    showPageError(error, 'Calendar failed to load');
  }
}

initCalendar();
