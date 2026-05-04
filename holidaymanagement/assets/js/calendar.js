import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState } from '../../shared/ui.js';
import { getApprovedLeaveForDate, getLeaveOverlap } from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

function toIsoDate(date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function parseIsoDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function longDate(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(parseIsoDate(iso));
}

function leaveTypeLabel(type) {
  if (type === 'annual') return 'Annual Request';
  if (type === 'sick') return 'Sick Leave';
  return 'Other Leave';
}

function monthStartEnd(selectedIsoDate) {
  const selectedDate = parseIsoDate(selectedIsoDate);
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  return {
    start: toIsoDate(new Date(year, month, 1)),
    end: toIsoDate(new Date(year, month + 1, 0))
  };
}

function buildCalendar(selectedIsoDate, datesWithLeave = new Set()) {
  const grid = document.getElementById('calendarGrid');
  const monthLabel = document.getElementById('monthLabel');
  const selectedDateLabel = document.getElementById('selectedDateLabel');

  if (!grid) return;

  const selectedDate = parseIsoDate(selectedIsoDate);
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  if (monthLabel) {
    monthLabel.textContent = new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      year: 'numeric'
    }).format(selectedDate);
  }

  if (selectedDateLabel) {
    selectedDateLabel.textContent = longDate(selectedIsoDate);
  }

  const firstDay = new Date(year, month, 1);
  const startDay = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = '';

  for (let i = 0; i < startDay; i += 1) {
    html += `<div class="calendar-cell calendar-empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const iso = toIsoDate(date);
    const active = iso === selectedIsoDate ? ' active-calendar-day' : '';
    const hasLeave = datesWithLeave.has(iso);

    html += `
      <button class="calendar-cell calendar-day${active}" type="button" data-date="${iso}">
        <span class="calendar-day-number">${day}</span>
        ${hasLeave ? `<span class="calendar-day-dot"></span>` : ''}
      </button>
    `;
  }

  grid.innerHTML = html;
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

    const grid = document.getElementById('calendarGrid');
    const datePicker = document.getElementById('calendarDatePicker');
    const findDateBtn = document.getElementById('findDateBtn');
    const heading = document.getElementById('selectedDateHeading');
    const list = document.getElementById('selectedDateLeaveList');
    const prevBtn = document.getElementById('prevMonthBtn');
    const nextBtn = document.getElementById('nextMonthBtn');

    findDateBtn?.classList.add('btn-white');

    let selectedIsoDate = toIsoDate(new Date());
    let currentMonthDots = new Set();

    async function loadMonthDots(isoDate) {
      const { start, end } = monthStartEnd(isoDate);
      const overlap = await getLeaveOverlap(profile.company_id, start, end);

      const dots = new Set();

      overlap
        .filter((item) => item.status === 'approved')
        .forEach((item) => {
          const startDate = parseIsoDate(item.start_date);
          const endDate = parseIsoDate(item.end_date);

          for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const iso = toIsoDate(d);
            if (iso >= start && iso <= end) dots.add(iso);
          }
        });

      currentMonthDots = dots;
    }

    async function loadDate(isoDate) {
      selectedIsoDate = isoDate;

      if (datePicker) datePicker.value = isoDate;
      if (heading) heading.textContent = `Who Is Off On ${longDate(isoDate)}`;

      await loadMonthDots(isoDate);
      buildCalendar(isoDate, currentMonthDots);

      const items = await getApprovedLeaveForDate(profile.company_id, isoDate);

      if (!items.length) {
        renderEmptyState(list, 'Nobody is off on this date.');
        return;
      }

      list.innerHTML = items.map((item) => `
        <article class="leave-card">
          <div class="leave-card-top">
            <div>
              <p class="leave-card-title">${item.employee_name || 'Employee'}</p>
              <p class="leave-card-subtitle">${item.job_title || '—'} • ${item.employee_id || '—'}</p>
              <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)}</p>
            </div>
            <div class="badge badge-${item.leave_type}">${leaveTypeLabel(item.leave_type)}</div>
          </div>
        </article>
      `).join('');
    }

    grid?.addEventListener('click', async (event) => {
      const button = event.target.closest('.calendar-day');
      if (!button) return;
      await loadDate(button.dataset.date);
    });

    findDateBtn?.addEventListener('click', async () => {
      if (datePicker?.value) await loadDate(datePicker.value);
    });

    prevBtn?.addEventListener('click', async () => {
      const current = parseIsoDate(selectedIsoDate);
      const previous = new Date(current.getFullYear(), current.getMonth() - 1, 1);
      await loadDate(toIsoDate(previous));
    });

    nextBtn?.addEventListener('click', async () => {
      const current = parseIsoDate(selectedIsoDate);
      const next = new Date(current.getFullYear(), current.getMonth() + 1, 1);
      await loadDate(toIsoDate(next));
    });

    await loadDate(selectedIsoDate);
    revealApp();
  } catch (error) {
    console.error('Calendar failed:', error);

    const loader = document.getElementById('appLoader');
    if (loader) {
      loader.innerHTML = `
        <div style="padding:24px;text-align:center;">
          <h2>Calendar failed to load</h2>
          <p>${error.message || 'Unknown error'}</p>
        </div>
      `;
    }
  }
}

initCalendar();
