import { requireAuth, isAdminProfile } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState } from '../../shared/ui.js';
import {
  getDashboardLeaveBreakdown,
  getMyLeaveRequests,
  leaveTypeLabel
} from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

function show(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function hide(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function titleCase(value) {
  const text = String(value || '').trim();
  if (!text) return '—';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function isTodayInRange(item, todayIso) {
  return item.start_date <= todayIso && item.end_date >= todayIso;
}

function calculateLeaveStats(profile, requests) {
  const allowance = Number(profile.annual_leave_allowance || 0);

  const used = (requests || [])
    .filter((request) =>
      request.status === 'approved' &&
      request.deduct_allowance !== false &&
      ['annual', 'other'].includes(request.leave_type)
    )
    .reduce((sum, request) => sum + Number(request.total_days || 0), 0);

  const remaining = Math.max(0, allowance - used);

  return { allowance, used, remaining };
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
      <p class="leave-card-title">${item.employee_name || item.display_name || item.full_name || 'Employee'}</p>
      <p class="leave-card-subtitle">
        ${leaveTypeLabel(item.leave_type)} • ${formatDate(item.start_date)} to ${formatDate(item.end_date)}
      </p>
      <p class="leave-card-subtitle">
        ${item.total_days || 0} day(s) ${item.reason ? `• ${item.reason}` : ''}
      </p>
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
      <p class="leave-card-title">${employee.full_name || employee.display_name || 'Employee'}</p>
      <p class="leave-card-subtitle">
        Birthday: ${employee.dob ? formatDate(employee.dob) : 'Date not set'}
      </p>
    </article>
  `).join('');
}

function setupDashboardPanelClicks() {
  document.querySelectorAll('[data-panel-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.panelTarget;

      document.querySelectorAll('.dashboard-detail-panel').forEach((panel) => {
        panel.classList.add('hidden');
      });

      document.querySelectorAll('.stat-button').forEach((stat) => {
        stat.classList.remove('active-stat-button');
      });

      document.getElementById(targetId)?.classList.remove('hidden');
      button.classList.add('active-stat-button');
    });
  });
}

async function initHome() {
  try {
    const auth = await requireAuth();
    if (!auth) return;

    const { user, profile } = auth;

    const authUserId = profile.user_id || profile.auth_user_id || user.id;
    const isAdmin = isAdminProfile(profile);
    const todayIso = new Date().toISOString().slice(0, 10);

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    setupDashboardPanelClicks();

    const displayName = profile.full_name || user.email || 'Employee';
    const displayEmail = profile.work_email || profile.email || profile.personal_email || user.email || '—';

    setText('welcomeText', `Welcome back, ${displayName}`);
    setText('profileName', displayName);
    setText('profileEmail', displayEmail);
    setText('profileRole', titleCase(profile.role));

    let myRequests = [];

    try {
      myRequests = await getMyLeaveRequests(authUserId);
    } catch (error) {
      console.warn('My requests failed:', error);
    }

    const stats = calculateLeaveStats(profile, myRequests);
    const pendingRequests = myRequests.filter((request) => request.status === 'pending').length;

    setText('profileRemaining', stats.remaining);
    setText('profileUsed', stats.used);
    setText('profilePending', pendingRequests);

    if (!isAdmin) {
      hide('adminDashboardSection');
      show('personalProfileSection');
      revealApp();
      return;
    }

    show('adminDashboardSection');
    show('personalProfileSection');

    let breakdown = {
      annualToday: [],
      sickToday: [],
      otherToday: [],
      annualNext7: [],
      sickNext7: [],
      otherNext7: [],
      birthdaysNext7: []
    };

    try {
      breakdown = await getDashboardLeaveBreakdown(profile.company_id);
    } catch (error) {
      console.warn('Dashboard breakdown failed:', error);
    }

    const annualToday = (breakdown.annualToday || []).filter((item) => isTodayInRange(item, todayIso));
    const sickToday = (breakdown.sickToday || []).filter((item) => isTodayInRange(item, todayIso));
    const otherToday = (breakdown.otherToday || []).filter((item) => isTodayInRange(item, todayIso));

    setText('annualTodayCount', annualToday.length);
    setText('sickTodayCount', sickToday.length);
    setText('otherTodayCount', otherToday.length);
    setText('birthdaysCount', breakdown.birthdaysNext7?.length || 0);

    renderLeaveList('annualTodayList', annualToday, 'Nobody is on annual leave today.');
    renderLeaveList('annualNext7List', breakdown.annualNext7 || [], 'No annual leave in the next 7 days.');

    renderLeaveList('sickTodayList', sickToday, 'Nobody is on sick leave today.');
    renderLeaveList('sickNext7List', breakdown.sickNext7 || [], 'No sick leave in the next 7 days.');

    renderLeaveList('otherTodayList', otherToday, 'Nobody is on other leave today.');
    renderLeaveList('otherNext7List', breakdown.otherNext7 || [], 'No other leave in the next 7 days.');

    renderBirthdayList('birthdaysNext7List', breakdown.birthdaysNext7 || []);

    document.querySelectorAll('.dashboard-detail-panel').forEach((panel) => {
      panel.classList.add('hidden');
    });

    document.querySelectorAll('.stat-button').forEach((button) => {
      button.classList.remove('active-stat-button');
    });

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
