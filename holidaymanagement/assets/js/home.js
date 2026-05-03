import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState } from '../../shared/ui.js';
import {
  getMyLeaveBalance,
  getMyLeaveRequests,
  getMySickRecords,
  getDashboardLeaveBreakdown,
  getEmployeeByUserId
} from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';
import { isManagerOrAdmin } from '../../shared/roles.js';

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function capitalise(value) {
  if (!value) return '—';
  return String(value).charAt(0).toUpperCase() + String(value).slice(1).toLowerCase();
}

function getDisplayName(employee, profile) {
  if (employee?.display_name && employee.display_name !== 'Employee') return employee.display_name;
  if (employee?.full_name) return employee.full_name;
  if (profile?.full_name) return profile.full_name;
  if (profile?.name) return profile.name;
  if (profile?.email) return profile.email;
  return 'Employee';
}

function leaveTypeLabel(type) {
  if (type === 'annual') return 'Annual Request';
  if (type === 'sick') return 'Sick Leave';
  return 'Other Leave';
}

function renderLeaveList(containerId, items, emptyText) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items || !items.length) {
    renderEmptyState(container, emptyText);
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${item.employee_name || item.display_name || 'Employee'}</p>
          <p class="leave-card-subtitle">${item.job_title || '—'} • ${item.employee_id || '—'}</p>
          <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days || 0} day(s)</p>
        </div>
        <div class="badge badge-${item.leave_type}">${leaveTypeLabel(item.leave_type)}</div>
      </div>
    </article>
  `).join('');
}

function renderBirthdayList(containerId, items) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items || !items.length) {
    renderEmptyState(container, 'No birthdays in the next 7 days.');
    return;
  }

  container.innerHTML = items.map((employee) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${employee.display_name || employee.full_name || 'Employee'}</p>
          <p class="leave-card-subtitle">${employee.job_title || '—'} • ${employee.employee_id || '—'}</p>
        </div>
        <div class="badge badge-annual">Birthday</div>
      </div>
    </article>
  `).join('');
}

async function initHome() {
  try {
    const auth = await requireAuth();
    if (!auth) return;

    const { profile } = auth;
    applyRoleUi(profile);

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    const currentYear = new Date().getFullYear();

    const [balance, requests, sickRecords, employee] = await Promise.all([
      getMyLeaveBalance(profile.user_id, currentYear),
      getMyLeaveRequests(profile.user_id),
      getMySickRecords(profile.user_id),
      getEmployeeByUserId(profile.user_id)
    ]);

    const displayName = getDisplayName(employee, profile);

    setText('welcomeText', `Welcome back, ${displayName}`);
    setText('profileName', displayName);
    setText('profileEmail', profile.email || '—');
    setText('profileRole', capitalise(profile.role));
    setText('profileRemaining', balance?.remaining_days ?? '0');
    setText('profileUsed', balance?.used_days ?? '0');
    setText('profilePending', requests.filter((item) => item.status === 'pending').length);

    if (isManagerOrAdmin(profile)) {
      const adminSection = document.getElementById('adminDashboardSection');
      if (adminSection) adminSection.classList.remove('hidden');

      const breakdown = await getDashboardLeaveBreakdown(profile.company_id);

      setText('annualTodayCount', breakdown.annualToday.length);
      setText('sickTodayCount', breakdown.sickToday.length);
      setText('otherTodayCount', breakdown.otherToday.length);
      setText('birthdaysCount', breakdown.birthdaysNext7.length);

      renderLeaveList('annualTodayList', breakdown.annualToday, 'Nobody is on annual leave today.');
      renderLeaveList('annualNext7List', breakdown.annualNext7, 'No annual leave in the next 7 days.');

      renderLeaveList('sickTodayList', breakdown.sickToday, 'Nobody is on sick leave today.');
      renderLeaveList('sickNext7List', breakdown.sickNext7, 'No sick leave in the next 7 days.');

      renderLeaveList('otherTodayList', breakdown.otherToday, 'Nobody is on other leave today.');
      renderLeaveList('otherNext7List', breakdown.otherNext7, 'No other leave in the next 7 days.');

      renderBirthdayList('birthdaysNext7List', breakdown.birthdaysNext7);

      document.querySelectorAll('.dashboard-detail-panel').forEach((panel) => {
        panel.classList.add('hidden');
      });

      document.querySelectorAll('[data-panel-target]').forEach((button) => {
        button.addEventListener('click', () => {
          const targetId = button.dataset.panelTarget;
          const target = document.getElementById(targetId);
          const isAlreadyOpen = target && !target.classList.contains('hidden');

          document.querySelectorAll('.dashboard-detail-panel').forEach((panel) => {
            panel.classList.add('hidden');
          });

          document.querySelectorAll('[data-panel-target]').forEach((btn) => {
            btn.classList.remove('active-stat-button');
          });

          if (!isAlreadyOpen && target) {
            target.classList.remove('hidden');
            button.classList.add('active-stat-button');
          }
        });
      });
    }

    revealApp();
  } catch (error) {
    console.error('Dashboard failed to load:', error);
    const loader = document.getElementById('appLoader');
    if (loader) {
      loader.innerHTML = `
        <div style="padding:24px;text-align:center;">
          <h2>Dashboard failed to load</h2>
          <p>${error.message || 'Unknown error'}</p>
        </div>
      `;
    }
  }
}

initHome();
