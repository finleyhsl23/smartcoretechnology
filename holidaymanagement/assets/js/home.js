import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, showPageError, badgeClass } from '../../shared/ui.js';
import { isManagerOrAdmin } from '../../shared/roles.js';
import { getMyLeaveBalance, getMyLeaveRequests, getDashboardLeaveBreakdown, getUpcomingBirthdays } from '../../shared/api.js';
import { formatDate, formatShortDate } from '../../shared/dates.js';

function renderSimplePeopleList(containerId, items, emptyText, type) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!items?.length) {
    renderEmptyState(container, emptyText);
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${item.employee_name || item.name || 'Employee'}</p>
          <p class="leave-card-subtitle">${formatDate(item.start_date || item.date)}${item.end_date ? ` to ${formatDate(item.end_date)}` : ''}</p>
        </div>
        <div class="${badgeClass(type)}">${type}</div>
      </div>
      ${item.reason ? `<div class="leave-card-bottom"><p class="leave-card-subtitle">${item.reason}</p></div>` : ''}
    </article>
  `).join('');
}

function activateAdminPanel(panelId) {
  document.querySelectorAll('.dashboard-detail-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== panelId);
  });
  document.querySelectorAll('.stat-button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.panelTarget === panelId);
  });
}

async function initHome() {
  try {
    const auth = await requireAuth();
    if (!auth) return;

    const { profile } = auth;
    applyRoleUi(profile);

    document.getElementById('welcomeText').textContent = `Welcome back, ${profile.full_name || profile.email || 'User'}`;
    document.getElementById('profileName').textContent = profile.full_name || '—';
    document.getElementById('profileEmail').textContent = profile.email || '—';
    document.getElementById('profileRole').textContent = profile.role || '—';

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    const currentYear = new Date().getFullYear();
    const [balance, requests] = await Promise.all([
      getMyLeaveBalance(profile.id, currentYear),
      getMyLeaveRequests(profile.id)
    ]);

    document.getElementById('profileRemaining').textContent = balance?.remaining_days ?? '0';
    document.getElementById('profileUsed').textContent = balance?.used_days ?? '0';
    document.getElementById('profilePending').textContent = requests.filter((item) => item.status === 'pending').length;

    if (isManagerOrAdmin(profile)) {
      document.getElementById('adminDashboardSection')?.classList.remove('hidden');

      const [breakdown, birthdays] = await Promise.all([
        getDashboardLeaveBreakdown(profile.company_id),
        getUpcomingBirthdays(profile.company_id)
      ]);

      document.getElementById('annualTodayCount').textContent = breakdown.annual.today.length;
      document.getElementById('sickTodayCount').textContent = breakdown.sick.today.length;
      document.getElementById('otherTodayCount').textContent = breakdown.other.today.length;
      document.getElementById('birthdaysCount').textContent = birthdays.length;

      renderSimplePeopleList('annualTodayList', breakdown.annual.today, 'Nobody is on annual leave today.', 'annual');
      renderSimplePeopleList('annualNext7List', breakdown.annual.next7, 'No annual leave starts in the next 7 days.', 'annual');
      renderSimplePeopleList('sickTodayList', breakdown.sick.today, 'Nobody is on sick leave today.', 'sick');
      renderSimplePeopleList('sickNext7List', breakdown.sick.next7, 'No sick leave starts in the next 7 days.', 'sick');
      renderSimplePeopleList('otherTodayList', breakdown.other.today, 'Nobody is on other leave today.', 'other');
      renderSimplePeopleList('otherNext7List', breakdown.other.next7, 'No other leave starts in the next 7 days.', 'other');

      const birthdayContainer = document.getElementById('birthdaysNext7List');
      if (!birthdays.length) {
        renderEmptyState(birthdayContainer, 'No birthdays in the next 7 days.');
      } else {
        birthdayContainer.innerHTML = birthdays.map((item) => `
          <article class="leave-card">
            <div class="leave-card-top">
              <div>
                <p class="leave-card-title">${item.name}</p>
                <p class="leave-card-subtitle">${formatShortDate(item.date)} • ${item.daysAway === 0 ? 'Today' : `In ${item.daysAway} day(s)`}</p>
              </div>
              <div class="${badgeClass('birthday')}">birthday</div>
            </div>
          </article>
        `).join('');
      }

      document.querySelectorAll('.stat-button').forEach((button) => {
        button.addEventListener('click', () => activateAdminPanel(button.dataset.panelTarget));
      });
      activateAdminPanel('annualLeavePanel');
    }

    revealApp();
  } catch (error) {
    showPageError(error, 'Dashboard failed to load');
  }
}

initHome();
