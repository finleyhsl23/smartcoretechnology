import { requireAdminPageAccess } from '../../shared/guards.js';
import { getLeaveRequestsByCompany, approveLeaveRequest, rejectLeaveRequest, cancelLeaveRequestAdmin, amendLeaveRequestAdmin, getEmployeesByCompany, addLeaveAdmin } from '../../shared/api.js';
import { revealApp, badgeClass, formatDate, showMessage, setLoadingButton, escapeHtml } from '../../shared/ui.js';
import { countWorkingDays } from '../../shared/dates.js';

let ctx, requests = [], allEmployees = [], whoOffData = [];
let selectedRequest = null;
let currentStatus = 'pending';
let currentType = '';
let manualSelectedEmployee = null;

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

  document.getElementById('closeDecisionModal').addEventListener('click', closeModal);
  document.getElementById('closeDecisionModal2').addEventListener('click', closeModal);
  document.getElementById('approveBtn').addEventListener('click', () => submitDecision('approved'));
  document.getElementById('rejectBtn').addEventListener('click', () => submitDecision('rejected'));

  // Who's off modal
  document.getElementById('whoOffBtn').addEventListener('click', openWhoOff);
  document.getElementById('closeWhoOffModal').addEventListener('click', () => document.getElementById('whoOffModal').classList.add('hidden'));
  document.getElementById('whoOffSearch').addEventListener('input', renderWhoOff);
  document.getElementById('whoOffDept').addEventListener('change', renderWhoOff);
  document.getElementById('whoOffPeriod').addEventListener('change', renderWhoOff);

  // Manual leave modal
  document.getElementById('addLeaveBtn').addEventListener('click', openManualLeave);
  document.getElementById('closeManualLeaveModal').addEventListener('click', () => document.getElementById('manualLeaveModal').classList.add('hidden'));
  document.getElementById('closeManualLeaveModal2').addEventListener('click', () => document.getElementById('manualLeaveModal').classList.add('hidden'));
  document.getElementById('saveManualLeaveBtn').addEventListener('click', submitManualLeave);
  document.getElementById('manualEmpSearch').addEventListener('input', searchManualEmployees);
  document.getElementById('manualStartDate').addEventListener('change', recalcManualDays);
  document.getElementById('manualEndDate').addEventListener('change', recalcManualDays);
}

function populateSidebar(company) {
  const initials = company.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('companyAvatar').textContent = initials;
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companyRole').textContent = company.role || 'Admin';
}

async function loadRequests() {
  [requests, allEmployees] = await Promise.all([
    getLeaveRequestsByCompany(ctx.company.id),
    getEmployeesByCompany(ctx.company.id)
  ]);
  filterAndRender();
}

function filterAndRender() {
  let filtered = requests;
  if (currentStatus === 'cancel_requested') {
    filtered = filtered.filter(r => r.status === 'cancellation_requested');
  } else if (currentStatus) {
    filtered = filtered.filter(r => r.status === currentStatus && r.status !== 'cancellation_requested');
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
    const isCancelReq = r.status === 'cancellation_requested';
    const typeLabel = r.leave_type ? r.leave_type.charAt(0).toUpperCase() + r.leave_type.slice(1) : '';
    const days = r.total_days || 0;

    return `
      <div class="leave-card" style="cursor:pointer" data-req-id="${r.id}">
        <div class="leave-card-top">
          <div class="leave-card-main">
            <p class="leave-card-title">${escapeHtml(name)}</p>
            <p class="leave-card-subtitle">${escapeHtml(dept)} &middot; ${typeLabel} Leave</p>
            <p class="muted small" style="margin-top:4px">${formatDate(r.start_date)} — ${formatDate(r.end_date)} &middot; ${days} day${days !== 1 ? 's' : ''}</p>
            ${r.notes ? `<p class="muted small" style="margin-top:4px;font-style:italic">"${escapeHtml(r.notes)}"</p>` : ''}
            ${isCancelReq ? `<p class="muted small" style="margin-top:4px;color:#ffcf7a">Cancel requested${r.cancellation_reason ? ': ' + escapeHtml(r.cancellation_reason) : ''}</p>` : ''}
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
  const days = r.total_days || 0;
  const isCancelReq = r.status === 'cancellation_requested';

  document.getElementById('decisionTitle').textContent = `${name} — ${typeLabel} Leave`;
  document.getElementById('decisionSub').textContent = `${formatDate(r.start_date)} — ${formatDate(r.end_date)} · ${days} day${days !== 1 ? 's' : ''}`;
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
    <div class="detail-tile"><span class="detail-label">Days</span><span class="detail-value">${days}</span></div>
    <div class="detail-tile"><span class="detail-label">Allowance</span><span class="detail-value">${r.employees?.annual_leave_allowance ?? '—'} days</span></div>
    ${r.notes ? `<div class="detail-tile" style="grid-column:1/-1"><span class="detail-label">Note</span><span class="detail-value">${escapeHtml(r.notes)}</span></div>` : ''}
    ${r.cancellation_reason ? `<div class="detail-tile" style="grid-column:1/-1"><span class="detail-label">Cancellation Reason</span><span class="detail-value">${escapeHtml(r.cancellation_reason)}</span></div>` : ''}
  `;

  const approveBtn = document.getElementById('approveBtn');
  const rejectBtn = document.getElementById('rejectBtn');
  if (r.status === 'pending' || isCancelReq) {
    approveBtn.style.display = '';
    rejectBtn.style.display = '';
    approveBtn.textContent = isCancelReq ? 'Approve Cancellation' : 'Approve';
    rejectBtn.textContent = isCancelReq ? 'Deny Cancellation' : 'Reject';
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
  const btn = decision === 'approved' ? document.getElementById('approveBtn') : document.getElementById('rejectBtn');
  const note = document.getElementById('decisionNote').value.trim();
  const deduct = document.getElementById('deductAllowance').checked;

  setLoadingButton(btn, true, decision === 'approved' ? 'Approving...' : 'Rejecting...');
  showMessage('decisionMsg', '', 'info');

  try {
    if (selectedRequest.status === 'cancellation_requested') {
      if (decision === 'approved') {
        await cancelLeaveRequestAdmin(selectedRequest, ctx.session.user.id, note);
      } else {
        await amendLeaveRequestAdmin(selectedRequest, ctx.session.user.id, { status: 'approved', cancellation_reason: null });
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

// ── Who's Off modal ──────────────────────────────────────────────

async function openWhoOff() {
  document.getElementById('whoOffModal').classList.remove('hidden');
  whoOffData = requests.filter(r => r.status === 'approved');

  // Populate dept dropdown
  const depts = [...new Set(allEmployees.map(e => e.department).filter(Boolean))].sort();
  const sel = document.getElementById('whoOffDept');
  sel.innerHTML = '<option value="">All Departments</option>';
  depts.forEach(d => { sel.innerHTML += `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`; });

  renderWhoOff();
}

function renderWhoOff() {
  const search = document.getElementById('whoOffSearch').value.toLowerCase();
  const dept = document.getElementById('whoOffDept').value;
  const period = document.getElementById('whoOffPeriod').value;
  const todayStr = new Date().toISOString().split('T')[0];
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);
  const in30Str = in30.toISOString().split('T')[0];

  let filtered = whoOffData;

  if (period === 'current') {
    filtered = filtered.filter(r => r.start_date <= todayStr && r.end_date >= todayStr);
  } else if (period === 'upcoming') {
    filtered = filtered.filter(r => r.start_date > todayStr && r.start_date <= in30Str);
  }

  if (dept) filtered = filtered.filter(r => r.employees?.department === dept);
  if (search) filtered = filtered.filter(r =>
    r.employees?.full_name?.toLowerCase().includes(search) ||
    r.employees?.department?.toLowerCase().includes(search)
  );

  const list = document.getElementById('whoOffList');
  if (!filtered.length) {
    list.innerHTML = `<p class="muted">No one found for this filter.</p>`;
    return;
  }

  list.innerHTML = filtered.map(r => `
    <div class="leave-card compact" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <p style="margin:0;font-weight:700">${escapeHtml(r.employees?.full_name || '—')}</p>
          <p class="muted small" style="margin:4px 0 0">${escapeHtml(r.employees?.department || 'No dept')} &middot; ${formatDate(r.start_date)} — ${formatDate(r.end_date)}</p>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="${badgeClass(r.leave_type)}">${escapeHtml(r.leave_type || '')}</span>
          <span class="muted small">${r.total_days || 0}d</span>
        </div>
      </div>
    </div>
  `).join('');
}

// ── Manual leave modal ─────────────────────────────────────────────

function openManualLeave() {
  manualSelectedEmployee = null;
  document.getElementById('manualEmpSearch').value = '';
  document.getElementById('manualEmpResults').innerHTML = '';
  document.getElementById('manualSelectedEmp').classList.add('hidden');
  document.getElementById('manualStartDate').value = '';
  document.getElementById('manualEndDate').value = '';
  document.getElementById('manualDaysDisplay').value = '';
  document.getElementById('manualNotes').value = '';
  showMessage('manualLeaveMsg', '', 'info');
  document.getElementById('manualLeaveModal').classList.remove('hidden');
}

function searchManualEmployees() {
  const q = document.getElementById('manualEmpSearch').value.toLowerCase();
  const results = document.getElementById('manualEmpResults');
  if (!q) { results.innerHTML = ''; return; }

  const matches = allEmployees.filter(e =>
    e.full_name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q)
  ).slice(0, 6);

  results.innerHTML = matches.length
    ? matches.map(e => `
        <button class="search-result-item" data-emp-id="${e.id}">
          <strong>${escapeHtml(e.full_name || e.email)}</strong>
          <span>${escapeHtml(e.department || e.job_title || '')}</span>
        </button>`).join('')
    : `<p class="search-result-empty muted small">No employees found</p>`;

  results.querySelectorAll('[data-emp-id]').forEach(btn => {
    btn.addEventListener('click', () => selectManualEmployee(allEmployees.find(e => e.id === btn.dataset.empId)));
  });
}

function selectManualEmployee(emp) {
  manualSelectedEmployee = emp;
  document.getElementById('manualEmpSearch').value = '';
  document.getElementById('manualEmpResults').innerHTML = '';
  document.getElementById('manualSelectedEmpName').textContent = emp.full_name || emp.email;
  document.getElementById('manualSelectedEmpSub').textContent = emp.department || emp.job_title || '';
  document.getElementById('manualSelectedEmp').classList.remove('hidden');
}

function recalcManualDays() {
  const start = document.getElementById('manualStartDate').value;
  const end = document.getElementById('manualEndDate').value;
  if (!start || !end || end < start) { document.getElementById('manualDaysDisplay').value = ''; return; }
  const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
  document.getElementById('manualDaysDisplay').value = `${days} day${days !== 1 ? 's' : ''}`;
}

async function submitManualLeave() {
  const btn = document.getElementById('saveManualLeaveBtn');
  if (!manualSelectedEmployee) {
    showMessage('manualLeaveMsg', 'Please select an employee.', 'error');
    return;
  }
  const start = document.getElementById('manualStartDate').value;
  const end = document.getElementById('manualEndDate').value;
  const leaveType = document.getElementById('manualLeaveType').value;
  const notes = document.getElementById('manualNotes').value.trim();

  if (!start || !end) { showMessage('manualLeaveMsg', 'Please select start and end dates.', 'error'); return; }
  if (end < start) { showMessage('manualLeaveMsg', 'End date must be after start date.', 'error'); return; }

  const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;

  setLoadingButton(btn, true, 'Saving...');
  showMessage('manualLeaveMsg', '', 'info');

  try {
    await addLeaveAdmin({
      company_id: ctx.company.id,
      employee_id: manualSelectedEmployee.id,
      user_id: manualSelectedEmployee.user_id || null,
      leave_type: leaveType,
      start_date: start,
      end_date: end,
      total_days: days,
      notes,
      approved_by: ctx.session.user.id
    });
    document.getElementById('manualLeaveModal').classList.add('hidden');
    await loadRequests();
  } catch (err) {
    showMessage('manualLeaveMsg', err.message, 'error');
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
