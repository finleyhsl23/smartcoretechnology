import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState } from '../../shared/ui.js';
import { getApprovedLeaveForDate } from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

function getMonthMatrix(year, month) {
  const firstDay = new Date(year, month, 1);
  const startDay = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startDay; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(new Date(year, month, d));

  return cells;
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

    const calendarGrid = document.getElementById('calendarGrid');
    const selectedDateTitle = document.getElementById('selectedDateTitle');
    const offList = document.getElementById('offList');
    const monthLabel = document.getElementById('monthLabel');
    const prevBtn = document.getElementById('prevMonthBtn');
    const nextBtn = document.getElementById('nextMonthBtn');

    let current = new Date();

    async function loadDate(date) {
      const iso = date.toISOString().slice(0, 10);
      selectedDateTitle.textContent = `Who is off on ${formatDate(iso)}`;

      const items = await getApprovedLeaveForDate(profile.company_id, iso);

      if (!items.length) {
        renderEmptyState(offList, 'Nobody is off on this date.');
        return;
      }

      offList.innerHTML = items.map((item) => `
        <article class="leave-card">
          <div class="leave-card-top">
            <div>
              <p class="leave-card-title">${item.employee_name}</p>
              <p class="leave-card-subtitle">${item.job_title || '—'} • ${item.employee_id || '—'}</p>
            </div>
            <div class="badge badge-${item.leave_type}">${item.leave_type === 'annual' ? 'Annual Request' : item.leave_type === 'sick' ? 'Sick Leave' : 'Other Leave'}</div>
          </div>
          <div class="leave-card-bottom">
            <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)}</p>
          </div>
        </article>
      `).join('');
    }

    function renderMonth() {
      const year = current.getFullYear();
      const month = current.getMonth();

      monthLabel.textContent = new Intl.DateTimeFormat('en-GB', {
        month: 'long',
        year: 'numeric'
      }).format(current);

      const cells = getMonthMatrix(year, month);

      calendarGrid.innerHTML = cells.map((date) => {
        if (!date) return `<div class="calendar-cell calendar-empty"></div>`;

        const iso = date.toISOString().slice(0, 10);
        return `
          <button class="calendar-cell calendar-day" data-date="${iso}">
            ${date.getDate()}
          </button>
        `;
      }).join('');

      calendarGrid.querySelectorAll('.calendar-day').forEach((btn) => {
        btn.addEventListener('click', async () => {
          await loadDate(new Date(btn.dataset.date));
        });
      });
    }

    prevBtn?.addEventListener('click', () => {
      current = new Date(current.getFullYear(), current.getMonth() - 1, 1);
      renderMonth();
    });

    nextBtn?.addEventListener('click', () => {
      current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
      renderMonth();
    });

    renderMonth();
    await loadDate(new Date());

    revealApp();
  } catch (error) {
    console.error('Calendar page failed:', error);
    const loader = document.getElementById('appLoader');
    if (loader) loader.innerHTML = `<div style="padding:24px;text-align:center;">Calendar failed to load<br><br>${error.message || 'Unknown error'}</div>`;
  }
}

initCalendar();
