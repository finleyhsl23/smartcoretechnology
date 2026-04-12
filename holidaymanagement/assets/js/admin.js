import { requireAdminPageAccess } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, badgeClass, showPageError } from '../../shared/ui.js';
import { getAllCompanyLeaveRequests, getAllCompanySickRecords, approveLeaveRequest, rejectLeaveRequest } from '../../shared/api.js';
import { formatDate, isDateInRange, toIsoDate } from '../../shared/dates.js';

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
    const sickRecords = await getAllCompanySickRecords(profile.company_id);

    function updateStats() {
      const todayIso = toIsoDate();
      document.getElementById('adminPendingCount').textContent = requests.filter((item) => item.status === 'pending').length;
      document.getElementById('adminApprovedToday').textContent = requests.filter((item) => item.status === 'approved' && item.approved_at?.slice(0, 10) === todayIso).length;
      document.getElementById('adminOffToday').textContent = requests.filter((item) => item.status === 'approved' && isDateInRange(todayIso, item.start_date, item.end_date)).length;
      document.getElementById('adminSickToday').textContent = sickRecords.filter((item) => item.sick_date === todayIso).length;
    }

    function renderList() {
      const filtered = requests.filter((item) => {
        const statusMatch = statusFilter.value === 'all' || item.status === statusFilter.value;
        const typeMatch = typeFilter.value === 'all' || item.leave_type === typeFilter.value;
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
              <p class="leave-card-title">${item.employee_name || 'Employee'} • ${item.leave_type}</p>
              <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days} day(s)</p>
            </div>
            <div class="${badgeClass(item.status)}">${item.status}</div>
          </div>
          <div class="leave-card-bottom">
            <p class="leave-card-subtitle">${item.reason || 'No reason provided'}</p>
            ${item.status === 'pending' ? `
              <div class="inline-actions">
                <button class="btn btn-primary" data-action="approve" data-id="${item.id}">Approve</button>
                <button class="btn btn-danger" data-action="reject" data-id="${item.id}">Reject</button>
              </div>
            ` : `<div class="${badgeClass(item.leave_type)}">${item.leave_type}</div>`}
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

        requests = await getAllCompanyLeaveRequests(profile.company_id);
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
    showPageError(error, 'Admin page failed to load');
  }
}

initAdmin();
