import { requireAdminPageAccess } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, showMessage } from '../../shared/ui.js';
import {
  getAllHolidayDates,
  addCompanyHoliday,
  updateCompanyHoliday,
  deleteCompanyHoliday
} from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

let profile = null;
let holidays = [];
let selectedDate = new Date();
let visibleCount = 30;

function toIsoDate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function todayIso() {
  return toIsoDate(new Date());
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function getHolidayName(holiday) {
  return holiday.name || holiday.title || 'Holiday';
}

function futureHolidaysOnly(items) {
  const today = todayIso();

  return (items || [])
    .filter((item) => item.holiday_date >= today)
    .sort((a, b) => String(a.holiday_date).localeCompare(String(b.holiday_date)));
}

function renderCalendar() {
  const grid = document.getElementById('holidayCalendarGrid');
  const label = document.getElementById('holidayMonthLabel');

  if (!grid || !label) return;

  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  label.textContent = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric'
  }).format(selectedDate);

  const holidaysByDate = new Map();

  holidays.forEach((holiday) => {
    if (!holidaysByDate.has(holiday.holiday_date)) {
      holidaysByDate.set(holiday.holiday_date, []);
    }

    holidaysByDate.get(holiday.holiday_date).push(holiday);
  });

  const firstDay = new Date(year, month, 1);
  const startDay = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = '';

  for (let i = 0; i < startDay; i += 1) {
    html += `<div class="calendar-cell calendar-empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toIsoDate(new Date(year, month, day));
    const hasHoliday = holidaysByDate.has(iso);

    html += `
      <button class="calendar-cell calendar-day holiday-calendar-day${hasHoliday ? ' has-holiday' : ''}" type="button" data-date="${iso}">
        <span class="calendar-day-number">${day}</span>
        ${hasHoliday ? `<span class="calendar-day-dot"></span>` : ''}
      </button>
    `;
  }

  grid.innerHTML = html;
}

function renderHolidayList() {
  const list = document.getElementById('holidayList');
  const loadMoreBtn = document.getElementById('loadMoreHolidaysBtn');

  if (!list) return;

  const future = futureHolidaysOnly(holidays);
  const shown = future.slice(0, visibleCount);

  if (!shown.length) {
    renderEmptyState(list, 'No upcoming holidays found.');
    loadMoreBtn?.classList.add('hidden');
    return;
  }

  list.innerHTML = shown.map((holiday) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${getHolidayName(holiday)}</p>
          <p class="leave-card-subtitle">
            ${formatDate(holiday.holiday_date)} • ${holiday.type === 'bank' ? 'Bank Holiday' : 'Company Holiday'}
          </p>
        </div>

        ${
          holiday.type === 'company'
            ? `
              <div class="inline-actions">
                <button class="btn btn-secondary icon-btn" data-edit-holiday="${holiday.id}" type="button" title="Edit holiday">✎</button>
                <button class="btn btn-danger icon-btn" data-delete-holiday="${holiday.id}" type="button" title="Delete holiday">×</button>
              </div>
            `
            : `<span class="badge">Bank Holiday</span>`
        }
      </div>
    </article>
  `).join('');

  if (future.length > visibleCount) {
    loadMoreBtn?.classList.remove('hidden');
  } else {
    loadMoreBtn?.classList.add('hidden');
  }
}

function openHolidayDateModal(isoDate) {
  const items = holidays.filter((holiday) => holiday.holiday_date === isoDate);

  document.getElementById('holidayViewTitle').textContent = `Holidays on ${formatDate(isoDate)}`;
  document.getElementById('holidayViewSubtitle').textContent = items.length
    ? `${items.length} holiday${items.length === 1 ? '' : 's'} found`
    : 'No holiday on this date';

  const content = document.getElementById('holidayViewContent');

  if (!items.length) {
    renderEmptyState(content, 'There is no bank holiday or company holiday on this date.');
  } else {
    content.innerHTML = items.map((holiday) => `
      <article class="leave-card">
        <div class="leave-card-top">
          <div>
            <p class="leave-card-title">${getHolidayName(holiday)}</p>
            <p class="leave-card-subtitle">
              ${formatDate(holiday.holiday_date)} • ${holiday.type === 'bank' ? 'Bank Holiday' : 'Company Holiday'}
            </p>
          </div>

          ${
            holiday.type === 'company'
              ? `<button class="btn btn-secondary" data-edit-holiday-from-view="${holiday.id}" type="button">Edit</button>`
              : `<span class="badge">Bank Holiday</span>`
          }
        </div>
      </article>
    `).join('');
  }

  openModal('holidayViewModal');
}

function openEditModal(holiday) {
  if (!holiday || holiday.type !== 'company') return;

  document.getElementById('editHolidayId').value = holiday.id;
  document.getElementById('editHolidayName').value = getHolidayName(holiday);
  document.getElementById('editHolidayDate').value = holiday.holiday_date;

  showMessage('holidayEditMessage', '');
  openModal('holidayEditModal');
}

async function loadHolidays() {
  holidays = futureHolidaysOnly(await getAllHolidayDates(profile.company_id));
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

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  document.getElementById('prevHolidayMonthBtn')?.addEventListener('click', () => {
    selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1);
    renderCalendar();
  });

  document.getElementById('nextHolidayMonthBtn')?.addEventListener('click', () => {
    selectedDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1);
    renderCalendar();
  });

  document.getElementById('holidayCalendarGrid')?.addEventListener('click', (event) => {
    const button = event.target.closest('.holiday-calendar-day');
    if (!button) return;

    openHolidayDateModal(button.dataset.date);
  });

  document.getElementById('holidayViewContent')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-edit-holiday-from-view]');
    if (!button) return;

    const holiday = holidays.find((item) => item.id === button.dataset.editHolidayFromView);

    closeModal('holidayViewModal');
    openEditModal(holiday);
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
      visibleCount = 30;

      showMessage('companyHolidayMessage', 'Company holiday added.', 'success');
      await loadHolidays();
    } catch (error) {
      showMessage('companyHolidayMessage', error.message || 'Could not add holiday.', 'error');
    }
  });

  document.getElementById('holidayList')?.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('button[data-edit-holiday]');
    const deleteBtn = event.target.closest('button[data-delete-holiday]');

    if (editBtn) {
      const holiday = holidays.find((item) => item.id === editBtn.dataset.editHoliday);
      openEditModal(holiday);
      return;
    }

    if (deleteBtn) {
      const holiday = holidays.find((item) => item.id === deleteBtn.dataset.deleteHoliday);
      if (!holiday) return;

      if (!confirm(`Delete ${getHolidayName(holiday)}?`)) return;

      await deleteCompanyHoliday(holiday.id);
      await loadHolidays();
    }
  });

  document.getElementById('holidayEditForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const id = document.getElementById('editHolidayId').value;

      await updateCompanyHoliday(id, {
        name: document.getElementById('editHolidayName').value.trim(),
        holiday_date: document.getElementById('editHolidayDate').value
      });

      closeModal('holidayEditModal');
      await loadHolidays();
    } catch (error) {
      showMessage('holidayEditMessage', error.message || 'Could not update holiday.', 'error');
    }
  });

  document.getElementById('deleteHolidayBtn')?.addEventListener('click', async () => {
    const id = document.getElementById('editHolidayId').value;
    const name = document.getElementById('editHolidayName').value || 'this holiday';

    if (!confirm(`Delete ${name}?`)) return;

    await deleteCompanyHoliday(id);
    closeModal('holidayEditModal');
    await loadHolidays();
  });

  document.getElementById('loadMoreHolidaysBtn')?.addEventListener('click', () => {
    visibleCount += 30;
    renderHolidayList();
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
