import { requireAuth, applyRoleUi } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, showPageError } from '../../shared/ui.js';
import {
  getMyLeaveRequests,
  leaveTypeLabel
} from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

function statusBadge(status) {
  return `<span class="badge badge-${status}">${status || 'pending'}</span>`;
}

function calculateLeaveStats(profile, requests) {
  const allowance = Number(profile.annual_leave_allowance || 0);

  const used = (requests || [])
    .filter((request) =>
      request.status === 'approved' &&
      request.deduct_allowance !== false &&
      ['annual', 'other'].includes(request.leave_type)
    )
    .reduce((sum, request) => sum + Number(request.total_days || 0), 0);

  const remaining = Math.max(0, allowance - used);
  const pending = (requests || []).filter((request) => request.status === 'pending').length;
  const approved = (requests || []).filter((request) => request.status === 'approved').length;

  return {
    allowance,
    used,
    remaining,
    pending,
    approved
  };
}

function renderRequests(container, requests) {
  if (!container) return;

  if (!requests || !requests.length) {
    renderEmptyState(container, 'No leave history yet.');
    return;
  }

  container.innerHTML = requests.map((request) => `
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

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    setText(
      'myLeaveWelcome',
      `Welcome back, ${profile.full_name || user.email || 'Employee'}. Here are your leave statistics:`
    );

    let requests = [];

    try {
      requests = await getMyLeaveRequests(authUserId);
    } catch (error) {
      console.warn('Leave history failed:', error);
    }

    const stats = calculateLeaveStats(profile, requests);

    setText('leaveAllowance', stats.allowance);
    setText('leaveUsed', stats.used);
    setText('leaveRemaining', stats.remaining);
    setText('leavePending', stats.pending);
    setText('leaveApproved', stats.approved);

    const list =
      document.getElementById('myLeaveList') ||
      document.getElementById('leaveHistoryList') ||
      document.getElementById('myLeaveRequestsList');

    renderRequests(list, requests);

    revealApp();
  } catch (error) {
    showPageError(error, 'My Leave failed to load');
  }
}

initMyLeavePage();
