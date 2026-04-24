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

async function initAdmin() {
  try {
    const auth = await requireAdminPageAccess();
    if (!auth) return;

    const { profile } = auth;

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

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
        <article class="leave-card">
          <div class="leave-card-top">
            <div>
              <p class="leave-card-title">${item.employee_name} • ${leaveTypeLabel(item.leave_type)}</p>
              <p class="leave-card-subtitle">${item.employee_id || '—'} • ${item.job_title || '—'}</p>
              <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days} day(s)</p>
            </div>
            <div class="badge badge-${item.status}">${item.status}</div>
          </div>

          <div class="leave-card-bottom stacked-bottom">
            <div>
              <p class="leave-card-subtitle"><strong>Reason:</strong> ${item.reason || 'No reason provided'}</p>
              <p class="leave-card-subtitle"><strong>Notes:</strong> ${item.notes || 'No notes added'}</p>
            </div>

            <div class="inline-actions">
              <button class="btn btn-secondary" data-action="more-info" data-id="${item.id}">More Info</button>
              ${
                item.status === 'pending'
                  ? `
                    <button class="btn btn-primary" data-action="approve" data-id="${item.id}">Approve</button>
                    <button class="btn btn-danger" data-action="reject" data-id="${item.id}">Reject</button>
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

        if (action === 'approve') {
          await approveLeaveRequest(request, profile.id);
        }

        if (action === 'reject') {
          const notes = window.prompt('Optional rejection note:') || '';
          await rejectLeaveRequest(request.id, profile.id, notes);
        }

        if (action === 'more-info') {
          const summary = await getEmployeeLeaveSummary(request.user_id);

          const historyHtml = (summary.requests || []).slice(0, 6).map((entry) => `
            <div class="mini-list-row">
              <strong>${leaveTypeLabel(entry.leave_type)}</strong>
              <span>${formatDate(entry.start_date)} to ${formatDate(entry.end_date)} • ${entry.status}</span>
            </div>
          `).join('') || '<div class="empty-state">No recent leave history.</div>';

          alert(
`${request.employee_name}
Employee ID: ${request.employee_id || '—'}
Job Title: ${request.job_title || '—'}

Annual allowance: ${summary.balance?.total_allowance ?? 0}
Used days: ${summary.balance?.used_days ?? 0}
Remaining days: ${summary.balance?.remaining_days ?? 0}

Reason: ${request.reason || 'No reason provided'}
Notes: ${request.notes || 'No notes added'}`
          );

          button.disabled = false;
          return;
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
    if (loader) loader.innerHTML = `<div style="padding:24px;text-align:center;">Admin failed to load<br><br>${error.message || 'Unknown error'}</div>`;
  }
}

initAdmin();
