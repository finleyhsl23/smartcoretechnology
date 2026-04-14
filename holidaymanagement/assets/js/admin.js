import { requireAdminPageAccess } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, badgeClass } from '../../shared/ui.js';
import {
  getAllCompanyLeaveRequests,
  getAllCompanySickRecords,
  getEmployeesByUserIds,
  getLeaveBalancesForUsers,
  approveLeaveRequest,
  rejectLeaveRequest
} from '../../shared/api.js';
import { formatDate, isDateInRange } from '../../shared/dates.js';

const auth = await requireAdminPageAccess();
if (!auth) throw new Error('Unauthorised');

const { profile } = auth;
const currentYear = new Date().getFullYear();

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
  await signOut();
  window.location.href = './login.html';
});

const adminLeaveList = document.getElementById('adminLeaveList');
const statusFilter = document.getElementById('adminStatusFilter');
const typeFilter = document.getElementById('adminTypeFilter');

const employeeModal = document.getElementById('employeeModal');
const closeEmployeeModal = document.getElementById('closeEmployeeModal');

let requests = [];
let sickRecords = [];
let employeesByUserId = new Map();
let balancesByUserId = new Map();

function buildFullName(employee, fallback = 'Employee') {
  if (!employee) return fallback;
  if (employee.full_name) return employee.full_name;
  const joined = [employee.first_name, employee.last_name].filter(Boolean).join(' ').trim();
  return joined || fallback;
}

function prettyType(type) {
  if (type === 'annual') return 'Annual Request';
  if (type === 'sick') return 'Sick Leave';
  if (type === 'other') return 'Other Leave';
  return type || 'Leave';
}

async function loadData() {
  requests = await getAllCompanyLeaveRequests(profile.company_id);
  sickRecords = await getAllCompanySickRecords(profile.company_id);

  const userIds = [...new Set(requests.map((item) => item.user_id).filter(Boolean))];
  const [employees, balances] = await Promise.all([
    getEmployeesByUserIds(userIds),
    getLeaveBalancesForUsers(userIds, currentYear)
  ]);

  employeesByUserId = new Map(employees.map((employee) => [employee.user_id, employee]));
  balancesByUserId = new Map(balances.map((balance) => [balance.user_id, balance]));
}

function updateStats() {
  const todayIso = new Date().toISOString().slice(0, 10);

  document.getElementById('adminPendingCount').textContent = requests.filter((item) => item.status === 'pending').length;
  document.getElementById('adminApprovedToday').textContent = requests.filter((item) => {
    return item.status === 'approved' && item.approved_at && item.approved_at.slice(0, 10) === todayIso;
  }).length;

  document.getElementById('adminOffToday').textContent = requests.filter((item) => {
    return item.status === 'approved' && isDateInRange(todayIso, item.start_date, item.end_date);
  }).length;

  document.getElementById('adminSickToday').textContent = sickRecords.filter((item) => item.sick_date === todayIso).length;
}

function getApprovedAnnualDaysForUser(userId) {
  return requests
    .filter((item) => item.user_id === userId && item.leave_type === 'annual' && item.status === 'approved')
    .reduce((sum, item) => sum + Number(item.total_days || 0), 0);
}

function renderHistoryForUser(userId) {
  const history = requests
    .filter((item) => item.user_id === userId)
    .slice(0, 6);

  const modalHistory = document.getElementById('modalHistory');

  if (!history.length) {
    modalHistory.innerHTML = '<div class="empty-state">No leave history available.</div>';
    return;
  }

  modalHistory.innerHTML = history.map((item) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${prettyType(item.leave_type)}</p>
          <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days} day(s)</p>
        </div>
        <div class="${badgeClass(item.status)}">${item.status}</div>
      </div>
    </article>
  `).join('');
}

function openEmployeeModal(requestId) {
  const request = requests.find((item) => item.id === requestId);
  if (!request) return;

  const employee = employeesByUserId.get(request.user_id);
  const balance = balancesByUserId.get(request.user_id);
  const fullName = buildFullName(employee);

  document.getElementById('modalEmployeeName').textContent = fullName;
  document.getElementById('modalEmployeeSub').textContent = `${prettyType(request.leave_type)} • ${formatDate(request.start_date)} to ${formatDate(request.end_date)}`;
  document.getElementById('modalEmployeeId').textContent = employee?.employee_id || '—';
  document.getElementById('modalJobTitle').textContent = employee?.job_title || '—';
  document.getElementById('modalAllowance').textContent = balance?.total_allowance ?? '0';
  document.getElementById('modalUsedDays').textContent = balance?.used_days ?? '0';
  document.getElementById('modalRemainingDays').textContent = balance?.remaining_days ?? '0';
  document.getElementById('modalApprovedAnnualDays').textContent = getApprovedAnnualDaysForUser(request.user_id);
  document.getElementById('modalReason').textContent = request.reason || 'No reason provided.';
  document.getElementById('modalNotes').textContent = request.notes || 'No notes added.';

  renderHistoryForUser(request.user_id);

  employeeModal.classList.remove('hidden');
}

function closeModal() {
  employeeModal.classList.add('hidden');
}

closeEmployeeModal?.addEventListener('click', closeModal);
employeeModal?.addEventListener('click', (event) => {
  if (event.target === employeeModal) closeModal();
});

function renderList() {
  const statusValue = statusFilter.value;
  const typeValue = typeFilter.value;

  const filtered = requests.filter((item) => {
    const statusMatch = statusValue === 'all' || item.status === statusValue;
    const typeMatch = typeValue === 'all' || item.leave_type === typeValue;
    return statusMatch && typeMatch;
  });

  if (!filtered.length) {
    renderEmptyState(adminLeaveList, 'No requests match the current filters.');
    return;
  }

  adminLeaveList.innerHTML = filtered.map((item) => {
    const employee = employeesByUserId.get(item.user_id);
    const balance = balancesByUserId.get(item.user_id);
    const fullName = buildFullName(employee);
    const employeeId = employee?.employee_id || '—';
    const jobTitle = employee?.job_title || '—';
    const remaining = balance?.remaining_days ?? '0';

    return `
      <article class="leave-card admin-request-card">
        <div class="leave-card-top">
          <div>
            <p class="leave-card-title">${fullName} • ${prettyType(item.leave_type)}</p>
            <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days} day(s)</p>
            <p class="leave-card-subtitle">Employee ID: ${employeeId} • Job Title: ${jobTitle}</p>
            <p class="leave-card-subtitle">Remaining Annual Leave: ${remaining}</p>
          </div>
          <div class="${badgeClass(item.status)}">${item.status}</div>
        </div>

        <div class="leave-card-bottom admin-request-bottom">
          <div>
            <p class="leave-card-subtitle"><strong>Reason:</strong> ${item.reason || 'No reason provided'}</p>
            <p class="leave-card-subtitle"><strong>Notes:</strong> ${item.notes || 'No notes added'}</p>
          </div>

          <div class="inline-actions">
            <button class="btn btn-secondary" data-action="more-info" data-id="${item.id}">More Info</button>
            ${item.status === 'pending' ? `
              <button class="btn btn-primary" data-action="approve" data-id="${item.id}">Approve</button>
              <button class="btn btn-danger" data-action="reject" data-id="${item.id}">Reject</button>
            ` : ''}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

adminLeaveList?.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const requestId = button.dataset.id;
  const request = requests.find((item) => item.id === requestId);
  if (!request) return;

  try {
    button.disabled = true;

    if (action === 'more-info') {
      openEmployeeModal(requestId);
      return;
    }

    if (action === 'approve') {
      await approveLeaveRequest(request, profile.id);
    }

    if (action === 'reject') {
      const notes = window.prompt('Optional rejection note:') || '';
      await rejectLeaveRequest(request.id, profile.id, notes);
    }

    await loadData();
    updateStats();
    renderList();
  } catch (error) {
    console.error(error);
    alert(error.message || 'Unable to update the request.');
  } finally {
    button.disabled = false;
  }
});

statusFilter?.addEventListener('change', renderList);
typeFilter?.addEventListener('change', renderList);

await loadData();
updateStats();
renderList();
revealApp();
