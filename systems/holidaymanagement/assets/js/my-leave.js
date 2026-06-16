import { requireAuth } from '../../shared/guards.js';
import { getMyLeaveRequests, requestLeaveCancellation, getMyEmployee, getLeaveRequestsByCompany, getLeaveUsedThisYear } from '../../shared/api.js';
import { revealApp, badgeClass, formatDate, showMessage, setLoadingButton, escapeHtml } from '../../shared/ui.js';

let ctx, requests, whoOffData = [];
let currentFilter = '';
let selectedRequestId = null;

async function init() {
  ctx = await requireAuth();
  if (!ctx) return;

  const { session, company } = ctx;
  populateSidebar(company);

  const [employee, leaveUsed] = await Promise.all([
    getMyEmployee(session.user.id, company.id),
    getLeaveUsedThisYear(null, company.id) // will be overridden below
  ]);

  // Get actual used days for this employee
  let taken = 0;
  if (employee) taken = await getLeaveUsedThisYear(employee.id, company.id);
  renderAllowance(employee, taken);

  requests = await getMyLeaveRequests(session.user.id, company.id);
  renderList(requests);
  revealApp();

  initCustomSelect('statusFilter', val => {
    currentFilter = val;
    const filtered = val ? requests.filter(r => r.status === val) : requests;
    renderList(filtered);
  });

  document.getElementById('closeCancelModal').addEventListener('click', closeCancel);
  document.getElementById('closeCancelModal2').addEventListener('click', closeCancel);
  document.getElementById('confirmCancelBtn').addEventListener('click', submitCancel);

  document.getElementById('whoOffBtn').addEventListener('click', openWhoOff);
  document.getElementById('closeWhoOffModal').addEventListener('click', () => document.getElementById('whoOffModal').classList.add('hidden'));
  document.getElementById('whoOffSearch').addEventListener('input', renderWhoOff);
  document.getElementById('whoOffDept').addEventListener('change', renderWhoOff);
  document.getElementById('whoOffPeriod').addEventListener('change', renderWhoOff);
}

function populateSidebar(company) {
  const initials = company.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('companyAvatar').textContent = initials;
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companyRole').textContent = company.role || 'Employee';
}

function renderAllowance(employee, taken) {
  const allowance = employee?.annual_leave_allowance ?? 28;
  const remaining = Math.max(0, allowance - taken);
  document.getElementById('statAllowance').textContent = allowance;
  document.getElementById('statTaken').textContent = taken;
  document.getElementById('statRemaining').textContent = remaining;
  document.getElementById('welcomeText').textContent = employee?.full_name || '';
}

function renderList(items) {
  const list = document.getElementById('leaveList');
  document.getElementById('leaveCount').textContent = `${items.length} request${items.length !== 1 ? 's' : ''}`;

  if (!items.length) {
    list.innerHTML = `<p class="empty-state muted">No leave requests found.</p>`;
    return;
  }

  list.innerHTML = items.map(r => {
    const canCancel = r.status === 'pending';
    const canRequestCancel = r.status === 'approved' && r.status !== 'cancellation_requested';
    const isCancelRequested = r.status === 'cancellation_requested';
    const days = r.total_days || 0;

    return `
      <div class="leave-card">
        <div class="leave-card-top">
          <div class="leave-card-main">
            <p class="leave-card-title">${escapeHtml(r.leave_type?.charAt(0).toUpperCase() + r.leave_type?.slice(1) || 'Leave')} Leave</p>
            <p class="leave-card-subtitle">${formatDate(r.start_date)} — ${formatDate(r.end_date)} &middot; ${days} day${days !== 1 ? 's' : ''}</p>
            ${r.notes ? `<p class="muted small" style="margin-top:6px">${escapeHtml(r.notes)}</p>` : ''}
          </div>
          <div class="leave-card-actions">
            <span class="${badgeClass(r.status)}">${isCancelRequested ? 'Cancel Requested' : escapeHtml(r.status)}</span>
            ${canCancel ? `<button class="btn btn-danger" data-cancel-id="${r.id}" data-cancel-type="withdraw">Withdraw</button>` : ''}
            ${canRequestCancel ? `<button class="btn btn-secondary" data-cancel-id="${r.id}" data-cancel-type="request">Request Cancellation</button>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-cancel-id]').forEach(btn => {
    btn.addEventListener('click', () => openCancel(btn.dataset.cancelId, btn.dataset.cancelType));
  });
}

function openCancel(id, type) {
  selectedRequestId = id;
  document.getElementById('cancelReason').value = '';
  showMessage('cancelMsg', '', 'info');
  document.getElementById('cancelModal').classList.remove('hidden');
  document.getElementById('confirmCancelBtn').dataset.cancelType = type;
}

function closeCancel() {
  document.getElementById('cancelModal').classList.add('hidden');
  selectedRequestId = null;
}

async function submitCancel() {
  const btn = document.getElementById('confirmCancelBtn');
  const type = btn.dataset.cancelType;
  const reason = document.getElementById('cancelReason').value.trim();
  const request = requests.find(r => r.id === selectedRequestId);
  if (!request) return;

  setLoadingButton(btn, true, 'Processing...');
  showMessage('cancelMsg', '', 'info');

  try {
    if (type === 'withdraw') {
      await import('../../shared/api.js').then(m =>
        m.cancelLeaveRequest(request.id, ctx.company.id, ctx.session.user.id)
      );
    } else {
      await requestLeaveCancellation(request, ctx.session.user.id, reason);
    }
    closeCancel();
    requests = await getMyLeaveRequests(ctx.session.user.id, ctx.company.id);
    const filtered = currentFilter ? requests.filter(r => r.status === currentFilter) : requests;
    renderList(filtered);
  } catch (err) {
    showMessage('cancelMsg', err.message, 'error');
  } finally {
    setLoadingButton(btn, false);
  }
}

// ── Who's off modal ──────────────────────────────────────────────

async function openWhoOff() {
  document.getElementById('whoOffModal').classList.remove('hidden');
  if (!whoOffData.length) {
    whoOffData = await getLeaveRequestsByCompany(ctx.company.id, { status: 'approved' });
  }
  // Populate dept filter
  const depts = [...new Set(whoOffData.map(r => r.employees?.department).filter(Boolean))].sort();
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
  if (period === 'current') filtered = filtered.filter(r => r.start_date <= todayStr && r.end_date >= todayStr);
  else if (period === 'upcoming') filtered = filtered.filter(r => r.start_date > todayStr && r.start_date <= in30Str);
  if (dept) filtered = filtered.filter(r => r.employees?.department === dept);
  if (search) filtered = filtered.filter(r =>
    r.employees?.full_name?.toLowerCase().includes(search) ||
    r.employees?.department?.toLowerCase().includes(search)
  );

  const list = document.getElementById('whoOffList');
  if (!filtered.length) { list.innerHTML = `<p class="muted">No one found for this filter.</p>`; return; }

  list.innerHTML = filtered.map(r => `
    <div class="leave-card compact" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <p style="margin:0;font-weight:700">${escapeHtml(r.employees?.full_name || '—')}</p>
          <p class="muted small" style="margin:4px 0 0">${escapeHtml(r.employees?.department || 'No dept')} &middot; ${formatDate(r.start_date)} — ${formatDate(r.end_date)}</p>
        </div>
        <span class="${badgeClass(r.leave_type)}">${escapeHtml(r.leave_type || '')}</span>
      </div>
    </div>
  `).join('');
}

function initCustomSelect(id, onChange) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  const trigger = wrap.querySelector('.custom-select-trigger');
  const menu = wrap.querySelector('.custom-select-menu');
  const btns = menu.querySelectorAll('button');
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
