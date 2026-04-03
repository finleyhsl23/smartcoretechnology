import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, badgeClass } from '../../shared/ui.js';
import { getMyLeaveBalance, getMyLeaveRequests, getMySickRecords } from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

async function initHome() {
  try {
    const auth = await requireAuth();
    if (!auth) return;

    const { profile } = auth;
    applyRoleUi(profile);

    const welcomeText = document.getElementById('welcomeText');
    if (welcomeText) {
      welcomeText.textContent = `Welcome back, ${profile.full_name || profile.email || 'User'}`;
    }

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    const currentYear = new Date().getFullYear();

    const [balance, requests, sickRecords] = await Promise.all([
      getMyLeaveBalance(profile.id, currentYear),
      getMyLeaveRequests(profile.id),
      getMySickRecords(profile.id)
    ]);

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
              <p class="leave-card-title">${item.leave_type === 'annual' ? 'Annual Leave' : 'Sick Leave'}</p>
              <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days} day(s)</p>
            </div>
            <div class="${badgeClass(item.status)}">${item.status}</div>
          </div>
        </article>
      `).join('');
    }

    revealApp();
  } catch (error) {
    console.error('Home page failed to load:', error);

    const loader = document.getElementById('appLoader');
    if (loader) {
      loader.classList.remove('hidden');
      loader.innerHTML = `
        <div style="max-width:700px;padding:24px;text-align:center;">
          <h2 style="margin-bottom:12px;">Dashboard failed to load</h2>
          <p style="margin:0 0 10px;">${error?.message || 'Unknown error'}</p>
          <p style="margin:0;">Check public.users and RLS policies first.</p>
        </div>
      `;
    }
  }
}

initHome();
