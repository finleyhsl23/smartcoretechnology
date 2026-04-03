import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, badgeClass } from '../../shared/ui.js';
import { getMyLeaveBalance, getMyLeaveRequests } from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

const auth = await requireAuth();
if (!auth) throw new Error('Unauthorised');

const { profile } = auth;
applyRoleUi(profile);

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await signOut();
  window.location.href = './login.html';
});

const currentYear = new Date().getFullYear();
const balance = await getMyLeaveBalance(profile.id, currentYear);
const requests = await getMyLeaveRequests(profile.id);

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
          <p class="leave-card-title">${item.leave_type === 'annual' ? 'Annual Leave' : 'Sick Leave'}</p>
          <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days} day(s)</p>
        </div>
        <div class="${badgeClass(item.status)}">${item.status}</div>
      </div>

      <div class="leave-card-bottom">
        <div class="${badgeClass(item.leave_type)}">${item.leave_type}</div>
        <p class="leave-card-subtitle">${item.reason || 'No reason provided'}</p>
      </div>
    </article>
  `).join('');
}

statusFilter?.addEventListener('change', renderList);
typeFilter?.addEventListener('change', renderList);

renderList();
revealApp();
