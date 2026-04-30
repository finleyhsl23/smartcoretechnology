import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, badgeClass } from '../../shared/ui.js';
import { getMyLeaveBalance, getMyLeaveRequests, getEmployeeByUserId } from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

function leaveTypeLabel(type) {
  if (type === 'annual') return 'Annual Request';
  if (type === 'sick') return 'Sick Leave';
  return 'Other Leave';
}

const auth = await requireAuth();
if (!auth) throw new Error('Unauthorised');

const { profile } = auth;
applyRoleUi(profile);

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await signOut();
  window.location.href = './login.html';
});

const currentYear = new Date().getFullYear();

const [balance, requests, employee] = await Promise.all([
  getMyLeaveBalance(profile.id, currentYear),
  getMyLeaveRequests(profile.id),
  getEmployeeByUserId(profile.id)
]);

const name = employee?.display_name && employee.display_name !== 'Employee'
  ? employee.display_name
  : profile.full_name || profile.email || 'there';

const welcome = document.getElementById('myLeaveWelcome');
if (welcome) {
  welcome.textContent = `Welcome back, ${name}. Here are your leave statistics.`;
}

document.getElementById('annualAllowance').textContent = balance?.total_allowance ?? '0';
document.getElementById('annualUsed').textContent = balance?.used_days ?? '0';
document.getElementById('annualRemaining').textContent = balance?.remaining_days ?? '0';

const statusFilter = document.getElementById('statusFilter');
const typeFilter = document.getElementById('typeFilter');
const myLeaveList = document.getElementById('myLeaveList');

function renderList() {
  const statusValue = statusFilter.value;
  const typeValue = typeFilter.value;

  const filtered = requests.filter((item) => {
    const statusMatch = statusValue === 'all' || item.status === statusValue;
    const typeMatch = typeValue === 'all' || item.leave_type === typeValue;
    return statusMatch && typeMatch;
  });

  if (!filtered.length) {
    renderEmptyState(myLeaveList, 'No leave requests match the current filters.');
    return;
  }

  myLeaveList.innerHTML = filtered.map((item) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${leaveTypeLabel(item.leave_type)}</p>
          <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days} day(s)</p>
        </div>
        <div class="${badgeClass(item.status)}">${item.status}</div>
      </div>

      <div class="leave-card-bottom">
        <div class="${badgeClass(item.leave_type)}">${leaveTypeLabel(item.leave_type)}</div>
        <p class="leave-card-subtitle">${item.reason || 'No reason provided'}</p>
      </div>
    </article>
  `).join('');
}

statusFilter?.addEventListener('change', renderList);
typeFilter?.addEventListener('change', renderList);

renderList();
revealApp();
