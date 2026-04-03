import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, badgeClass } from '../../shared/ui.js';
import { getMyLeaveBalance, getMyLeaveRequests, getMySickRecords } from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

const auth = await requireAuth();
if (!auth) throw new Error('Unauthorised');

const { profile } = auth;
applyRoleUi(profile);

document.getElementById('welcomeText').textContent = `Welcome back, ${profile.full_name || profile.email}`;
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await signOut();
  window.location.href = './login.html';
});

const currentYear = new Date().getFullYear();
const balance = await getMyLeaveBalance(profile.id, currentYear);
const requests = await getMyLeaveRequests(profile.id);
const sickRecords = await getMySickRecords(profile.id);

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
