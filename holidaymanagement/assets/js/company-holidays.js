import { requireAdminPageAccess } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, showMessage } from '../../shared/ui.js';
import {
  getAllHolidayDates,
  addCompanyHoliday,
  deleteCompanyHoliday
} from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

let profile = null;
let holidays = [];
let selectedDate = new Date();

function toIsoDate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function parseIsoDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function renderCalendar() {
  const grid = document.getElementById('holidayCalendarGrid');
  const label = document.getElementById('holidayMonthLabel');

  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  label.textContent = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric'
  }).format(selectedDate);

  const holidayDates = new Set(holidays.map((item) => item.holiday_date));

  const firstDay = new Date(year, month, 1);
  const startDay = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = '';

  for (let i = 0; i < startDay; i += 1) {
    html += `<div class="calendar-cell calendar-empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toIsoDate(new Date(year, month, day));
    const hasHoliday = holidayDates.has(iso);

    html += `
      <div class="calendar-cell calendar-day">
        <span class="calendar-day-number">${day}</span>
        ${hasHoliday ? `<span class="calendar-day-dot"></span>` : ''}
      </div>
    `;
  }

  grid.innerHTML = html;
}

function renderHolidayList() {
  const list = document.getElementById('holidayList');

  if (!holidays.length) {
    renderEmptyState(list, 'No holidays found.');
    return;
  }

  list.innerHTML = holidays.map((holiday) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${holiday.name || holiday.title || 'Holiday'}</p>
          <p class="leave-card-subtitle">${formatDate(holiday.holiday_date)} • ${holiday.type}</p>
        </div>

        ${
          holiday.type === 'company'
            ? `<button class="btn btn-danger" data-delete-holiday="${holiday.id}" type="button">Delete</button>`
            : `<span class="badge">Bank Holiday</span>`
        }
      </div>
    </article>
  `).join('');
}

async function loadHolidays() {
  holidays = await getAllHolidayDates(profile.company_id);
  renderCalendar();
  renderHolidayList();
}

async function init() {
  const auth = await requireAdminPageAccess();
  if (!auth) return;

  profile = auth.profile;

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut();
    window.location.href = './login.html';
  });

  document.getElementById('prevHolidayMonthBtn')?.addEventListener('click', () => {
    selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1);
    renderCalendar();
  });

  document.getElementById('nextHolidayMonthBtn')?.addEventListener('click', () => {
    selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1);
    renderCalendar();
  });

  document.getElementById('companyHolidayForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      await addCompanyHoliday({
        company_id: profile.company_id,
        name: document.getElementById('holidayName').value.trim(),
        holiday_date: document.getElementById('holidayDate').value
      });

      document.getElementById('companyHolidayForm').reset();
      showMessage('companyHolidayMessage', 'Company holiday added.', 'success');
      await loadHolidays();
    } catch (error) {
      showMessage('companyHolidayMessage', error.message || 'Could not add holiday.', 'error');
    }
  });

  document.getElementById('holidayList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-delete-holiday]');
    if (!button) return;

    if (!confirm('Delete this company holiday?')) return;

    await deleteCompanyHoliday(button.dataset.deleteHoliday);
    await loadHolidays();
  });

  await loadHolidays();
  revealApp();
}

init().catch((error) => {
  console.error(error);

  const loader = document.getElementById('appLoader');
  if (loader) {
    loader.innerHTML = `
      <div style="padding:24px;text-align:center;">
        <h2>Company Holidays failed to load</h2>
        <p>${error.message || 'Unknown error'}</p>
      </div>
    `;
  }
});
