import { requireAdminPageAccess } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState } from '../../shared/ui.js';
import {
  getAllCompanyLeaveRequests,
  getAllCompanySickRecords,
  approveLeaveRequest,
  rejectLeaveRequest,
  enrichRequestsWithEmployeeInfo,
  getEmployeeLeaveSummary
} from '../../shared/api.js';
import { formatDate, isDateInRange } from '../../shared/dates.js';

function leaveTypeLabel(value) {
  if (value === 'annual') return 'Annual Request';
  if (value === 'sick') return 'Sick Leave';
  return 'Other Leave';
}

function capitalise(value) {
  if (!value) return '—';
  return String(value).charAt(0).toUpperCase() + String(value).slice(1).toLowerCase();
}

function safeValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function prettifyKey(key) {
  return key
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function renderEmployeeProfile(employee) {
  const body = document.getElementById('employeeProfileBody');
  const title = document.getElementById('employeeProfileTitle');

  if (!body) return;

  if (!employee) {
    body.innerHTML = '<div class="empty-state">No employee profile found. Make sure public.employees.user_id is linked to this user.</div>';
    return;
  }

  if (title) title.textContent = employee.display_name || employee.full_name || 'Employee Profile';

  const preferredOrder = [
    'employee_code',
    'full_name',
    'job_title',
    'role',
    'status',
    'work_email',
    'email',
    'personal_email',
    'personal_phone',
    'employment_type',
    'notice_period',
    'start_date',
    'dob',
    'title',
    'pronouns',
    'gender',
    'nationality',
    'ni_number',
    'driving_licence_number',
    'address_line1',
    'address_line2',
    'address_city',
    'address_county',
    'address_postcode',
    'address_country',
    'onboarding_status',
    'is_admin',
    'created_at',
    'user_id',
    'company_id',
    'id'
  ];

  const allKeys = Object.keys(employee);
  const orderedKeys = [
    ...preferredOrder.filter((key) => allKeys.includes(key)),
    ...allKeys.filter((key) => !preferredOrder.includes(key) && !['display_name', 'employee_id', 'primary_email', 'primary_phone', 'address_full'].includes(key))
  ];

  body.innerHTML = `
    <div class="employee-profile-hero">
      <div>
        <h3>${employee.display_name || employee.full_name || 'Employee'}</h3>
        <p>${employee.employee_code || '—'} • ${employee.job_title || '—'}</p>
      </div>
      <div class="badge badge-approved">${capitalise(employee.status || 'active')}</div>
    </div>

    <div class="employee-profile-grid">
      ${orderedKeys.map((key) => `
        <div class="detail-tile">
          <span class="detail-label">${prettifyKey(key)}</span>
          <strong>${safeValue(employee[key])}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

async function renderRequestModal(request) {
  const modalTitle = document.getElementById('modalTitle');
  const modalSubtitle = document.getElementById('modalSubtitle');
  const body = document.getElementById('requestModalBody');

  if (!body) return;

  const summary = await getEmployeeLeaveSummary(request.user_id);

  if (modalTitle) modalTitle.textContent = `${request.employee_name} • ${leaveTypeLabel(request.leave_type)}`;
  if (modalSubtitle) modalSubtitle.textContent = `${formatDate(request.start_date)} to ${formatDate(request.end_date)} • ${request.total_days} day(s)`;

  const historyHtml = (summary.requests || []).slice(0, 8).map((entry) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${leaveTypeLabel(entry.leave_type)}</p>
          <p class="leave-card-subtitle">${formatDate(entry.start_date)} to ${formatDate(entry.end_date)} • ${entry.total_days} day(s)</p>
        </div>
        <div class="badge badge-${entry.status}">${entry.status}</div>
      </div>
    </article>
  `).join('') || '<div class="empty-state">No recent leave history found.</div>';

  body.innerHTML = `
    <div class="modal-grid">
      <div class="detail-tile">
        <span class="detail-label">Full Name</span>
        <strong>${request.employee_name || 'Employee'}</strong>
      </div>
      <div class="detail-tile">
        <span class="detail-label">Employee ID</span>
        <strong>${request.employee_code || request.employee_id || '—'}</strong>
      </div>
      <div class="detail-tile">
        <span class="detail-label">Job Title</span>
        <strong>${request.job_title || '—'}</strong>
      </div>
      <div class="detail-tile">
        <span class="detail-label">Annual Allowance</span>
        <strong>${summary.balance?.total_allowance ?? 0}</strong>
      </div>
      <div class="detail-tile">
        <span class="detail-label">Used Days</span>
        <strong>${summary.balance?.used_days ?? 0}</strong>
      </div>
      <div class="detail-tile">
        <span class="detail-label">Remaining Days</span>
        <strong>${summary.balance?.remaining_days ?? 0}</strong>
      </div>
    </div>

    <div class="modal-section">
      <h3>Request Reason</h3>
      <p class="modal-text-box">${request.reason || 'No reason provided.'}</p>
    </div>

    <div class="modal-section">
      <h3>Notes</h3>
      <p class="modal-text-box">${request.notes || 'No notes added.'}</p>
    </div>

    <div class="modal-section">
      <button class="btn btn-primary" type="button" id="viewEmployeeProfileBtn">View Employee Profile</button>
    </div>

    <div class="modal-section">
      <h3>Recent Leave History</h3>
      <div class="compact-list">${historyHtml}</div>
    </div>
  `;

  document.getElementById('viewEmployeeProfileBtn')?.addEventListener('click', () => {
    renderEmployeeProfile(request.employee);
    openModal('employeeProfileModal');
  });

  openModal('requestModal');
}

async function initAdmin() {
  try {
    const auth = await requireAdminPageAccess();
    if (!auth) return;

    const { profile } = auth;

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    document.getElementById('closeRequestModal')?.addEventListener('click', () => closeModal('requestModal'));
    document.getElementById('closeEmployeeProfileModal')?.addEventListener('click', () => closeModal('employeeProfileModal'));

    const adminLeaveList = document.getElementById('adminLeaveList');
    const statusFilter = document.getElementById('adminStatusFilter');
    const typeFilter = document.getElementById('adminTypeFilter');

    let requests = await getAllCompanyLeaveRequests(profile.company_id);
    requests = await enrichRequestsWithEmployeeInfo(requests, profile.company_id);

    const sickRecords = await getAllCompanySickRecords(profile.company_id);

    function updateStats() {
      const todayIso = new Date().toISOString().slice(0, 10);

      document.getElementById('adminPendingCount').textContent = requests.filter((item) => item.status === 'pending').length;
      document.getElementById('adminApprovedToday').textContent = requests.filter((item) => item.status === 'approved' && item.approved_at && item.approved_at.slice(0, 10) === todayIso).length;
      document.getElementById('adminOffToday').textContent = requests.filter((item) => item.status === 'approved' && isDateInRange(todayIso, item.start_date, item.end_date)).length;
      document.getElementById('adminSickToday').textContent = sickRecords.filter((item) => item.sick_date === todayIso).length;
    }

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

      adminLeaveList.innerHTML = filtered.map((item) => `
        <article class="leave-card admin-request-card">
          <div class="leave-card-top">
            <div>
              <p class="leave-card-title">${item.employee_name} • ${leaveTypeLabel(item.leave_type)}</p>
              <p class="leave-card-subtitle">${item.employee_code || item.employee_id || '—'} • ${item.job_title || '—'} • ${item.employee_email || '—'}</p>
              <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days} day(s)</p>
            </div>
            <div class="badge badge-${item.status}">${capitalise(item.status)}</div>
          </div>

          <div class="leave-card-bottom admin-request-bottom">
            <div>
              <p class="leave-card-subtitle"><strong>Reason:</strong> ${item.reason || 'No reason provided'}</p>
              <p class="leave-card-subtitle"><strong>Notes:</strong> ${item.notes || 'No notes added'}</p>
            </div>

            <div class="inline-actions">
              <button class="btn btn-secondary" data-action="more-info" data-id="${item.id}" type="button">More Info</button>
              ${
                item.status === 'pending'
                  ? `
                    <button class="btn btn-primary" data-action="approve" data-id="${item.id}" type="button">Approve</button>
                    <button class="btn btn-danger" data-action="reject" data-id="${item.id}" type="button">Reject</button>
                  `
                  : ''
              }
            </div>
          </div>
        </article>
      `).join('');
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
          await renderRequestModal(request);
          return;
        }

        if (action === 'approve') {
          await approveLeaveRequest(request, profile.id);
        }

        if (action === 'reject') {
          const notes = window.prompt('Optional rejection note:') || '';
          await rejectLeaveRequest(request.id, profile.id, notes);
        }

        requests = await getAllCompanyLeaveRequests(profile.company_id);
        requests = await enrichRequestsWithEmployeeInfo(requests, profile.company_id);

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

    updateStats();
    renderList();
    revealApp();
  } catch (error) {
    console.error('Admin page failed:', error);
    const loader = document.getElementById('appLoader');
    if (loader) {
      loader.innerHTML = `<div style="padding:24px;text-align:center;">Admin failed to load<br><br>${error.message || 'Unknown error'}</div>`;
    }
  }
}

initAdmin();
