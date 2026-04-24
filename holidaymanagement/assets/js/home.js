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

function renderNameList(items, emptyText) {
  if (!items.length) return `<div class="empty-state">${emptyText}</div>`;

  return items.map((item) => `
    <div class="mini-list-row">
      <strong>${item.employee_name || item.display_name || 'Employee'}</strong>
      <span>${formatDate(item.start_date || item.dob || new Date())}</span>
    </div>
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
      getMyLeaveBalance(profile.id, currentYear),
      getMyLeaveRequests(profile.id),
      getMySickRecords(profile.id),
      getEmployeeByUserId(profile.id)
    ]);

    const welcome = document.getElementById('welcomeText');
    if (welcome) {
      welcome.textContent = `Welcome back, ${employee.display_name || profile.full_name || profile.email}`;
    }

    const personalProfile = document.getElementById('personalProfile');
    if (personalProfile) {
      personalProfile.innerHTML = `
        <div class="profile-grid">
          <div><span class="muted">Full Name</span><strong>${employee.display_name || '—'}</strong></div>
          <div><span class="muted">Employee ID</span><strong>${employee.employee_id || '—'}</strong></div>
          <div><span class="muted">Job Title</span><strong>${employee.job_title || '—'}</strong></div>
          <div><span class="muted">Annual Allowance</span><strong>${balance?.total_allowance ?? 0}</strong></div>
          <div><span class="muted">Used Days</span><strong>${balance?.used_days ?? 0}</strong></div>
          <div><span class="muted">Remaining Days</span><strong>${balance?.remaining_days ?? 0}</strong></div>
        </div>
      `;
    }

    document.getElementById('remainingDays').textContent = balance?.remaining_days ?? '0';
    document.getElementById('usedDays').textContent = balance?.used_days ?? '0';
    document.getElementById('pendingCount').textContent = requests.filter((item) => item.status === 'pending').length;
    document.getElementById('sickCount').textContent = sickRecords.length;

    const recentLeaveList = document.getElementById('recentLeaveList');
    const recent = requests.slice(0, 5);

    if (!recent.length) {
      renderEmptyState(recentLeaveList, 'No leave requests yet.');
    } else {
      recentLeaveList.innerHTML = recent.map((item) => `
        <article class="leave-card">
          <div class="leave-card-top">
            <div>
              <p class="leave-card-title">${item.leave_type === 'annual' ? 'Annual Request' : item.leave_type === 'sick' ? 'Sick Leave' : 'Other Leave'}</p>
              <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days} day(s)</p>
            </div>
            <div class="badge badge-${item.status}">${item.status}</div>
          </div>
        </article>
      `).join('');
    }

    const adminSection = document.getElementById('adminDashboardSection');

    if (isManagerOrAdmin(profile) && adminSection) {
      adminSection.classList.remove('hidden');

      const breakdown = await getDashboardLeaveBreakdown(profile.company_id);

      document.getElementById('annualLeaveTodayCount').textContent = breakdown.annualToday.length;
      document.getElementById('sickLeaveTodayCount').textContent = breakdown.sickToday.length;
      document.getElementById('otherLeaveTodayCount').textContent = breakdown.otherToday.length;
      document.getElementById('birthdaysNext7Count').textContent = breakdown.birthdaysNext7.length;

      document.getElementById('annualLeaveDetails').innerHTML = `
        <h3>Today</h3>
        ${renderNameList(breakdown.annualToday, 'Nobody is on annual leave today.')}
        <h3 class="sub-heading">In The Next 7 Days</h3>
        ${renderNameList(breakdown.annualNext7, 'No annual leave in the next 7 days.')}
      `;

      document.getElementById('sickLeaveDetails').innerHTML = `
        <h3>Today</h3>
        ${renderNameList(breakdown.sickToday, 'Nobody is on sick leave today.')}
        <h3 class="sub-heading">In The Next 7 Days</h3>
        ${renderNameList(breakdown.sickNext7, 'No sick leave in the next 7 days.')}
      `;

      document.getElementById('otherLeaveDetails').innerHTML = `
        <h3>Today</h3>
        ${renderNameList(breakdown.otherToday, 'Nobody is on other leave today.')}
        <h3 class="sub-heading">In The Next 7 Days</h3>
        ${renderNameList(breakdown.otherNext7, 'No other leave in the next 7 days.')}
      `;

      document.getElementById('birthdaysDetails').innerHTML = breakdown.birthdaysNext7.length
        ? breakdown.birthdaysNext7.map((employee) => `
            <div class="mini-list-row">
              <strong>${employee.display_name}</strong>
              <span>${employee.job_title || '—'}</span>
            </div>
          `).join('')
        : `<div class="empty-state">No birthdays in the next 7 days.</div>`;

      document.querySelectorAll('.expand-card-btn').forEach((button) => {
        button.addEventListener('click', () => {
          const targetId = button.dataset.target;
          const target = document.getElementById(targetId);
          if (target) target.classList.toggle('hidden');
        });
      });
    }

    revealApp();
  } catch (error) {
    console.error('Home page failed to load:', error);
    const loader = document.getElementById('appLoader');
    if (loader) {
      loader.innerHTML = `<div style="padding:24px;text-align:center;">Dashboard failed to load<br><br>${error.message || 'Unknown error'}</div>`;
    }
  }
}

initHome();
