import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, showPageError } from '../../shared/ui.js';
import {
  getMyLeaveRequests,
  getMyLeaveBalance,
  leaveTypeLabel,
  requestLeaveCancellation
} from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

let allRequests = [];

function setText(ids, value) {
  const idList = Array.isArray(ids) ? ids : [ids];

  idList.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? '—';
  });
}

function statusBadge(status) {
  return `<span class="badge badge-${status}">${status || 'pending'}</span>`;
}

function setupCustomStatusFilter(onChange) {
  const select = document.getElementById('myLeaveStatusSelect') || document.getElementById('leaveStatusSelect');
  if (!select) return;

  const trigger = select.querySelector('.custom-select-trigger');
  const menu = select.querySelector('.custom-select-menu');

  trigger?.addEventListener('click', (event) => {
    event.stopPropagation();
    select.classList.toggle('open');
  });

  menu?.querySelectorAll('button[data-value]').forEach((button) => {
    button.addEventListener('click', () => {
      select.dataset.value = button.dataset.value;

      const span = trigger?.querySelector('span');
      if (span) span.textContent = button.textContent.trim();

      select.classList.remove('open');
      onChange();
    });
  });

  document.addEventListener('click', () => {
    select.classList.remove('open');
  });
}

function getStatusFilterValue() {
  return (
    document.getElementById('myLeaveStatusSelect')?.dataset.value ||
    document.getElementById('leaveStatusSelect')?.dataset.value ||
    'all'
  );
}

function calculateLeaveStats(profile, requests, balance) {
  const fallbackAllowance = Number(profile.annual_leave_allowance || 0);

  const fallbackUsed = (requests || [])
    .filter((request) =>
      request.status === 'approved' &&
      request.deduct_allowance !== false &&
      ['annual', 'other'].includes(request.leave_type)
    )
    .reduce((sum, request) => sum + Number(request.total_days || 0), 0);

  const allowance = Number(balance?.total_allowance ?? fallbackAllowance);
  const used = Number(balance?.used_days ?? fallbackUsed);
  const remaining = Number(balance?.remaining_days ?? Math.max(0, allowance - used));

  return {
    allowance,
    used,
    remaining,
    pending: (requests || []).filter((request) => request.status === 'pending').length,
    approved: (requests || []).filter((request) => request.status === 'approved').length
  };
}

function renderRequests(container, requests) {
  if (!container) return;

  const statusFilter = getStatusFilterValue();
  let filtered = [...(requests || [])];

  if (statusFilter !== 'all') {
    filtered = filtered.filter((request) => request.status === statusFilter);
  }

  if (!filtered.length) {
    renderEmptyState(container, 'No leave history found for this filter.');
    return;
  }

  container.innerHTML = filtered.map((request) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${leaveTypeLabel(request.leave_type)}</p>
          <p class="leave-card-subtitle">
            ${formatDate(request.start_date)} to ${formatDate(request.end_date)} • ${request.total_days || 0} day(s)
          </p>
        </div>
        ${statusBadge(request.status)}
      </div>

      <div class="leave-card-bottom stacked-bottom">
        <p class="leave-card-subtitle"><strong>Reason:</strong> ${request.reason || 'No reason provided'}</p>
        <p class="leave-card-subtitle"><strong>Notes:</strong> ${request.notes || 'No notes added'}</p>

        ${
          request.cancellation_reason
            ? `<p class="leave-card-subtitle"><strong>Cancellation reason:</strong> ${request.cancellation_reason}</p>`
            : ''
        }

        ${
          request.status === 'approved'
            ? `<div class="inline-actions">
                <button class="btn btn-danger" data-cancel-request="${request.id}" type="button">
                  Request Cancellation
                </button>
              </div>`
            : ''
        }

        ${
          request.status === 'cancel_requested'
            ? `<p class="leave-card-subtitle"><strong>Cancellation pending approval</strong></p>`
            : ''
        }
      </div>
    </article>
  `).join('');
}

async function initMyLeavePage() {
  try {
    const auth = await requireAuth();
    if (!auth) return;

    const { profile, user } = auth;
    applyRoleUi(profile);

    const authUserId = profile.user_id || profile.auth_user_id || user.id;
    const currentYear = new Date().getFullYear();

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    let balance = null;

    allRequests = await getMyLeaveRequests(authUserId).catch(() => []);
    balance = await getMyLeaveBalance(authUserId, currentYear).catch(() => null);

    const stats = calculateLeaveStats(profile, allRequests, balance);

    setText(
      ['myLeaveWelcome', 'welcomeText'],
      `Welcome back, ${profile.full_name || user.email || 'Employee'}. Here are your leave statistics:`
    );

    setText(['leaveAllowance', 'myAllowance', 'annualAllowance', 'profileAllowance'], stats.allowance);
    setText(['leaveUsed', 'myUsed', 'annualUsed', 'profileUsed'], stats.used);
    setText(['leaveRemaining', 'myRemaining', 'annualRemaining', 'profileRemaining'], stats.remaining);
    setText(['leavePending', 'myPending', 'profilePending'], stats.pending);
    setText(['leaveApproved', 'myApproved'], stats.approved);

    const list =
      document.getElementById('myLeaveList') ||
      document.getElementById('leaveHistoryList') ||
      document.getElementById('myLeaveRequestsList') ||
      document.getElementById('requestsList');

    renderRequests(list, allRequests);

    setupCustomStatusFilter(() => {
      renderRequests(list, allRequests);
    });

    list?.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-cancel-request]');
      if (!button) return;

      const request = allRequests.find((item) => item.id === button.dataset.cancelRequest);
      if (!request) return;

      const reason = window.prompt('Why do you want to cancel this leave?');
      if (reason === null) return;

      button.disabled = true;
      button.textContent = 'Requesting...';

      try {
        await requestLeaveCancellation(request, authUserId, reason.trim());
        window.location.reload();
      } catch (error) {
        alert(error.message || 'Unable to request cancellation.');
        button.disabled = false;
        button.textContent = 'Request Cancellation';
      }
    });

    revealApp();
  } catch (error) {
    showPageError(error, 'My Leave failed to load');
  }
}

initMyLeavePage();
