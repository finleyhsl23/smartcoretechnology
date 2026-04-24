import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState } from '../../shared/ui.js';
import { getApprovedLeaveForDate } from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

function leaveTypeLabel(type) {
  if (type === 'annual') return 'Annual Request';
  if (type === 'sick') return 'Sick Leave';
  return 'Other Leave';
}

function buildSimpleCalendar(selectedDate) {
  const grid = document.getElementById('calendarGrid');
  if (!grid) return;

  const selected = new Date(selectedDate);
  const year = selected.getFullYear();
  const month = selected.getMonth();

  const firstDay = new Date(year, month, 1);
  const startDay = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];

  for (let i = 0; i < startDay; i += 1) {
    cells.push(`<div class="calendar-cell calendar-empty"></div>`);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const iso = date.toISOString().slice(0, 10);
    const activeClass = iso === selectedDate ? ' active-calendar-day' : '';

    cells.push(`
      <button class="calendar-cell calendar-day${activeClass}" type="button" data-date="${iso}">
        ${day}
      </button>
    `);
  }

  grid.innerHTML = cells.join('');
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

    const datePicker = document.getElementById('calendarDatePicker');
    const heading = document.getElementById('selectedDateHeading');
    const list = document.getElementById('selectedDateLeaveList');

    const todayIso = new Date().toISOString().slice(0, 10);
    if (datePicker) datePicker.value = todayIso;

    async function loadDate(isoDate) {
      if (heading) heading.textContent = `Who Is Off On ${formatDate(isoDate)}`;

      buildSimpleCalendar(isoDate);

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

      document.querySelectorAll('.calendar-day').forEach((button) => {
        button.addEventListener('click', async () => {
          const selected = button.dataset.date;
          if (datePicker) datePicker.value = selected;
          await loadDate(selected);
        });
      });
    }

    datePicker?.addEventListener('change', async () => {
      await loadDate(datePicker.value);
    });

    await loadDate(todayIso);

    revealApp();
  } catch (error) {
    console.error('Calendar failed to load:', error);
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
