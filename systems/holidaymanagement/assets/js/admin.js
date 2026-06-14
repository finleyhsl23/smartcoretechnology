import { requireAdminPageAccess } from '../../shared/guards.js';
import { getLeaveRequestsByCompany, approveLeaveRequest, rejectLeaveRequest, cancelLeaveRequestAdmin } from '../../shared/api.js';
import { revealApp, badgeClass, formatDate, showMessage, setLoadingButton, escapeHtml } from '../../shared/ui.js';

let ctx, requests = [];
let selectedRequest = null;
let currentStatus = 'pending';
let currentType = '';

async function init() {
  ctx = await requireAdminPageAccess();
  if (!ctx) return;

  populateSidebar(ctx.company);
  await loadRequests();
  revealApp();

  initCustomSelect('statusFilter', val => {
    currentStatus = val;
    filterAndRender();
  });

  document.getElementById('typeFilter').addEventListener('change', e => {
    currentType = e.target.value;
    filterAndRender();
  });

  document.getElementById('closeDecisionModal').addEventListener('click', () => closeModal());
  document.getElementById('closeDecisionModal2').addEventListener('click', () => closeModal());
  document.getElementById('approveBtn').addEventListener('click', () => submitDecision('approved'));
  document.getElementById('rejectBtn').addEventListener('click', () => submitDecision('rejected'));
}

function populateSidebar(company) {
  const initials = company.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('companyAvatar').textContent = initials;
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companyRole').textContent = company.role || 'Admin';
}

async function loadRequests() {
  requests = await getLeaveRequestsByCompany(ctx.company.id);
  filterAndRender();
}

function filterAndRender() {
  let filtered = requests;
  if (currentStatus === 'cancel_requested') {
    filtered = filtered.filter(r => r.cancel_requested);
  } else if (currentStatus) {
    filtered = filtered.filter(r => r.status === currentStatus && !r.cancel_requested);
  }
  if (currentType) filtered = filtered.filter(r => r.leave_type === currentType);

  document.getElementById('reqCount').textContent = `${filtered.length} request${filtered.length !== 1 ? 's' : ''}`;
  renderList(filtered);
}

function renderList(items) {
  const list = document.getElementById('requestList');
  if (!items.length) {
    list.innerHTML = `<p class="empty-state muted">No requests found.</p>`;
    return;
  }

  list.innerHTML = items.map(r => {
    const name = r.employees?.full_name || '—';
    const dept = r.employees?.department || '';
    const isCancelReq = r.cancel_requested;
    const typeLabel = r.leave_type ? r.leave_type.charAt(0).toUpperCase() + r.leave_type.slice(1) : '';

    return `
      <div class="leave-card" style="cursor:pointer" data-req-id="${r.id}">
        <div class="leave-card-top">
          <div class="leave-card-main">
            <p class="leave-card-title">${escapeHtml(name)}</p>
            <p class="leave-card-subtitle">${escapeHtml(dept)} &middot; ${typeLabel} Leave</p>
            <p class="muted small" style="margin-top:4px">${formatDate(r.start_date)} — ${formatDate(r.end_date)} &middot; ${r.days_requested} day${r.days_requested !== 1 ? 's' : ''}</p>
            ${r.notes ? `<p class="muted small" style="margin-top:4px;font-style:italic">"${escapeHtml(r.notes)}"</p>` : ''}
            ${isCancelReq ? `<p class="muted small" style="margin-top:4px;color:#ffcf7a">Cancel requested${r.cancel_reason ? ': ' + escapeHtml(r.cancel_reason) : ''}</p>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            ${isCancelReq ? `<span class="${badgeClass('cancel_requested')}">Cancel Request</span>` : `<span class="${badgeClass(r.status)}">${escapeHtml(r.status)}</span>`}
            <span class="${badgeClass(r.leave_type)}">${escapeHtml(typeLabel)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-req-id]').forEach(card => {
    card.addEventListener('click', () => {
      selectedRequest = requests.find(r => r.id === card.dataset.reqId);
      openDecisionModal(selectedRequest);
    });
  });
}

function openDecisionModal(r) {
  const name = r.employees?.full_name || '—';
  const typeLabel = r.leave_type ? r.leave_type.charAt(0).toUpperCase() + r.leave_type.slice(1) : '';

  document.getElementById('decisionTitle').textContent = `${name} — ${typeLabel} Leave`;
  document.getElementById('decisionSub').textContent = `${formatDate(r.start_date)} — ${formatDate(r.end_date)} · ${r.days_requested} days`;
  document.getElementById('decisionNote').value = '';
  document.getElementById('deductToggleRow').style.display = r.leave_type === 'annual' ? '' : 'none';
  document.getElementById('deductAllowance').checked = true;
  showMessage('decisionMsg', '', 'info');

  const details = document.getElementById('decisionDetails');
  details.innerHTML = `
    <div class="detail-tile"><span class="detail-label">Employee</span><span class="detail-value">${escapeHtml(name)}</span></div>
    <div class="detail-tile"><span class="detail-label">Leave Type</span><span class="detail-value"><span class="${badgeClass(r.leave_type)}">${escapeHtml(typeLabel)}</span></span></div>
    <div class="detail-tile"><span class="detail-label">Status</span><span class="detail-value"><span class="${badgeClass(r.status)}">${escapeHtml(r.status)}</span></span></div>
    <div class="detail-tile"><span class="detail-label">Start Date</span><span class="detail-value">${formatDate(r.start_date)}</span></div>
    <div class="detail-tile"><span class="detail-label">End Date</span><span class="detail-value">${formatDate(r.end_date)}</span></div>
    <div class="detail-tile"><span class="detail-label">Days</span><span class="detail-value">${r.days_requested}</span></div>
    <div class="detail-tile"><span class="detail-label">Allowance</span><span class="detail-value">${r.employees?.annual_leave_allowance ?? '—'} days</span></div>
    <div class="detail-tile"><span class="detail-label">Taken</span><span class="detail-value">${r.employees?.leave_taken ?? '—'} days</span></div>
    ${r.notes ? `<div class="detail-tile" style="grid-column:1/-1"><span class="detail-label">Employee Note</span><span class="detail-value">${escapeHtml(r.notes)}</span></div>` : ''}
  `;

  // Show/hide buttons based on state
  const approveBtn = document.getElementById('approveBtn');
  const rejectBtn = document.getElementById('rejectBtn');
  if (r.status === 'pending' || r.cancel_requested) {
    approveBtn.style.display = '';
    rejectBtn.style.display = '';
    if (r.cancel_requested) {
      approveBtn.textContent = 'Approve Cancellation';
      rejectBtn.textContent = 'Deny Cancellation';
    } else {
      approveBtn.textContent = 'Approve';
      rejectBtn.textContent = 'Reject';
    }
  } else {
    approveBtn.style.display = 'none';
    rejectBtn.style.display = 'none';
  }

  document.getElementById('decisionModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('decisionModal').classList.add('hidden');
  selectedRequest = null;
}

async function submitDecision(decision) {
  const btn = decision === 'approved'
    ? document.getElementById('approveBtn')
    : document.getElementById('rejectBtn');
  const note = document.getElementById('decisionNote').value.trim();
  const deduct = document.getElementById('deductAllowance').checked;

  setLoadingButton(btn, true, decision === 'approved' ? 'Approving...' : 'Rejecting...');
  showMessage('decisionMsg', '', 'info');

  try {
    if (selectedRequest.cancel_requested) {
      if (decision === 'approved') {
        await cancelLeaveRequestAdmin(selectedRequest, ctx.session.user.id, note);
      } else {
        // Deny cancellation — just clear the flag
        await import('../../shared/api.js').then(m =>
          m.amendLeaveRequestAdmin(selectedRequest, ctx.session.user.id, { cancel_requested: false, cancel_reason: null })
        );
      }
    } else if (decision === 'approved') {
      await approveLeaveRequest(selectedRequest, ctx.session.user.id, note, deduct);
    } else {
      await rejectLeaveRequest(selectedRequest, ctx.session.user.id, note);
    }

    closeModal();
    await loadRequests();
  } catch (err) {
    showMessage('decisionMsg', err.message, 'error');
  } finally {
    setLoadingButton(btn, false);
  }
}

function initCustomSelect(id, onChange) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  const trigger = wrap.querySelector('.custom-select-trigger');
  const btns = wrap.querySelectorAll('.custom-select-menu button');
  const label = trigger.querySelector('b');

  trigger.addEventListener('click', () => wrap.classList.toggle('open'));
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) wrap.classList.remove('open'); });

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      label.textContent = btn.textContent;
      wrap.classList.remove('open');
      onChange(btn.dataset.val);
    });
  });
}

init();
