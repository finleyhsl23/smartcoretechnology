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
let listEl = null;

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

function getCustomSelectValue(id) {
  return document.getElementById(id)?.dataset.value || 'all';
}

function setupCustomSelect(id, onChange) {
  const select = document.getElementById(id);
  if (!select) return;

  const trigger = select.querySelector('.custom-select-trigger');
  const menu = select.querySelector('.custom-select-menu');

  trigger?.addEventListener('click', (event) => {
    event.stopPropagation();

    document.querySelectorAll('.custom-select.open').forEach((openSelect) => {
      if (openSelect !== select) openSelect.classList.remove('open');
    });

    select.classList.toggle('open');
  });

  menu?.querySelectorAll('button[data-value]').forEach((button) => {
    button.addEventListener('click', () => {
      select.dataset.value = button.dataset.value;

      const span = trigger?.querySelector('span');
      if (span) span.textContent = button.textContent.trim();

      select.classList.remove('open');

      if (typeof onChange === 'function') {
        onChange();
      }
    });
  });
}

function setupCustomDropdowns() {
  setupCustomSelect('myLeaveStatusSelect', () => renderRequests());
  setupCustomSelect('myLeaveTypeSelect', () => renderRequests());

  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select.open').forEach((select) => {
      select.classList.remove('open');
    });
  });
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

function getFilteredRequests() {
  const statusFilter = getCustomSelectValue('myLeaveStatusSelect');
  const typeFilter = getCustomSelectValue('myLeaveTypeSelect');

  let filtered = [...allRequests];

  if (statusFilter !== 'all') {
    filtered = filtered.filter((request) => request.status === statusFilter);
  }

  if (typeFilter !== 'all') {
    filtered = filtered.filter((request) => request.leave_type === typeFilter);
  }

  return filtered;
}

function renderRequests() {
  const container = listEl;

  if (!container) return;

  const requests = getFilteredRequests();

  if (!requests.length) {
    renderEmptyState(container, 'No leave history found for these filters.');
    return;
  }

  container.innerHTML = requests.map((request) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div class="leave-card-main">
          <p class="leave-card-title">${leaveTypeLabel(request.leave_type)}</p>

          <p class="leave-card-subtitle">
            ${formatDate(request.start_date)} to ${formatDate(request.end_date)} • ${request.total_days || 0} day(s)
          </p>

          <p class="leave-card-subtitle">
            <strong>Reason:</strong> ${request.reason || 'No reason provided'}
          </p>

          <p class="leave-card-subtitle">
            <strong>Notes:</strong> ${request.notes || 'No notes added'}
          </p>

          ${
            request.cancellation_reason
              ? `
                <p class="leave-card-subtitle">
                  <strong>Cancellation reason:</strong> ${request.cancellation_reason}
                </p>
              `
              : ''
          }

          ${
            request.status === 'cancel_requested'
              ? `
                <p class="leave-card-subtitle">
                  <strong>Cancellation pending approval</strong>
                </p>
              `
              : ''
          }
        </div>

        <div class="leave-card-actions">
          ${statusBadge(request.status)}

          ${
            request.status === 'approved'
              ? `
                <button class="btn btn-danger"
                  data-cancel-request="${request.id}"
                  type="button">
                  Request Cancellation
                </button>
              `
              : ''
          }
        </div>
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

    allRequests = await getMyLeaveRequests(authUserId).catch(() => []);
    const balance = await getMyLeaveBalance(authUserId, currentYear).catch(() => null);

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

    listEl =
      document.getElementById('myLeaveList') ||
      document.getElementById('leaveHistoryList') ||
      document.getElementById('myLeaveRequestsList') ||
      document.getElementById('requestsList');

    setupCustomDropdowns();
    renderRequests();

    listEl?.addEventListener('click', async (event) => {
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
