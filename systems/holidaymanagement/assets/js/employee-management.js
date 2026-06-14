import { requireAdminPageAccess } from '../../shared/guards.js';
import { getEmployeesByCompany, updateEmployee, deactivateEmployee, reactivateEmployee, sendEmployeeInvite } from '../../shared/api.js';
import { revealApp, badgeClass, formatDate, showMessage, setLoadingButton, escapeHtml } from '../../shared/ui.js';

let ctx, employees = [];
let selectedEmployee = null;

async function init() {
  ctx = await requireAdminPageAccess();
  if (!ctx) return;

  const { company } = ctx;
  populateSidebar(company);
  await loadEmployees();
  revealApp();

  document.getElementById('searchInput').addEventListener('input', filterList);
  document.getElementById('statusFilter').addEventListener('change', filterList);
  document.getElementById('deptFilter').addEventListener('change', filterList);

  document.getElementById('inviteBtn').addEventListener('click', () => openModal('inviteModal'));
  document.getElementById('closeInviteModal').addEventListener('click', () => closeModal('inviteModal'));
  document.getElementById('closeInviteModal2').addEventListener('click', () => closeModal('inviteModal'));
  document.getElementById('sendInviteBtn').addEventListener('click', submitInvite);

  document.getElementById('closeEmpModal').addEventListener('click', () => closeModal('empModal'));
}

function populateSidebar(company) {
  const initials = company.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('companyAvatar').textContent = initials;
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companyRole').textContent = company.role || 'Admin';
}

async function loadEmployees() {
  employees = await getEmployeesByCompany(ctx.company.id);

  // Populate department filter
  const depts = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();
  const deptFilter = document.getElementById('deptFilter');
  depts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    deptFilter.appendChild(opt);
  });

  document.getElementById('empCount').textContent = `${employees.length} employee${employees.length !== 1 ? 's' : ''}`;
  renderList(employees);
}

function filterList() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const status = document.getElementById('statusFilter').value;
  const dept = document.getElementById('deptFilter').value;

  const filtered = employees.filter(e => {
    const matchSearch = !search ||
      e.full_name?.toLowerCase().includes(search) ||
      e.email?.toLowerCase().includes(search) ||
      e.department?.toLowerCase().includes(search) ||
      e.job_title?.toLowerCase().includes(search);
    const matchStatus = !status || e.status === status;
    const matchDept = !dept || e.department === dept;
    return matchSearch && matchStatus && matchDept;
  });

  renderList(filtered);
}

function renderList(items) {
  const list = document.getElementById('employeeList');
  if (!items.length) {
    list.innerHTML = `<p class="empty-state muted">No employees found.</p>`;
    return;
  }

  list.innerHTML = items.map(e => `
    <div class="leave-card compact" style="cursor:pointer" data-emp-id="${e.id}">
      <div class="leave-card-top">
        <div class="leave-card-main">
          <p class="leave-card-title">${escapeHtml(e.full_name || e.email || '—')}</p>
          <p class="leave-card-subtitle">${[e.job_title, e.department].filter(Boolean).map(escapeHtml).join(' · ') || 'No details'}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="${badgeClass(e.role || 'employee')}">${escapeHtml(e.role || 'employee')}</span>
          <span class="${badgeClass(e.status || 'active')}">${escapeHtml(e.status || 'active')}</span>
          <span class="muted small">${e.annual_leave_allowance ?? 28}d allowance</span>
        </div>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-emp-id]').forEach(card => {
    card.addEventListener('click', () => {
      selectedEmployee = employees.find(e => e.id === card.dataset.empId);
      openEmployeeModal(selectedEmployee);
    });
  });
}

function openEmployeeModal(e) {
  document.getElementById('empModalName').textContent = e.full_name || e.email || '—';
  document.getElementById('empModalSub').textContent = [e.job_title, e.department].filter(Boolean).join(' · ') || 'No details';

  const taken = e.leave_taken ?? 0;
  const allowance = e.annual_leave_allowance ?? 28;

  document.getElementById('empModalBody').innerHTML = `
    <div class="modal-grid" style="margin-bottom:18px">
      <div class="detail-tile"><span class="detail-label">Email</span><span class="detail-value">${escapeHtml(e.email || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Phone</span><span class="detail-value">${escapeHtml(e.phone || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Status</span><span class="detail-value"><span class="${badgeClass(e.status)}">${escapeHtml(e.status)}</span></span></div>
      <div class="detail-tile"><span class="detail-label">Role</span><span class="detail-value"><span class="${badgeClass(e.role)}">${escapeHtml(e.role || 'employee')}</span></span></div>
      <div class="detail-tile"><span class="detail-label">Start Date</span><span class="detail-value">${formatDate(e.start_date)}</span></div>
      <div class="detail-tile"><span class="detail-label">Date of Birth</span><span class="detail-value">${formatDate(e.date_of_birth)}</span></div>
      <div class="detail-tile"><span class="detail-label">Allowance</span><span class="detail-value">${allowance} days</span></div>
      <div class="detail-tile"><span class="detail-label">Taken</span><span class="detail-value">${taken} days</span></div>
      <div class="detail-tile"><span class="detail-label">Remaining</span><span class="detail-value">${Math.max(0, allowance - taken)} days</span></div>
    </div>

    <div class="modal-section">
      <h3>Edit Allowance</h3>
      <div style="display:flex;gap:10px;align-items:flex-end">
        <div class="field" style="flex:1">
          <label>Annual Leave Allowance (days)</label>
          <input type="number" id="editAllowance" value="${allowance}" min="0" max="365" />
        </div>
        <button class="btn btn-primary" id="saveAllowanceBtn">Save</button>
      </div>
      <p class="form-message" id="allowanceMsg"></p>
    </div>

    <div class="modal-actions" style="margin-top:18px">
      ${e.status === 'active'
        ? `<button class="btn btn-danger" id="deactivateBtn">Deactivate</button>`
        : `<button class="btn btn-success" id="reactivateBtn">Reactivate</button>`}
    </div>
  `;

  document.getElementById('saveAllowanceBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveAllowanceBtn');
    const val = parseInt(document.getElementById('editAllowance').value);
    if (isNaN(val)) return;
    setLoadingButton(btn, true, 'Saving...');
    try {
      await updateEmployee(e.id, ctx.company.id, { annual_leave_allowance: val });
      e.annual_leave_allowance = val;
      showMessage('allowanceMsg', 'Saved.', 'success');
    } catch (err) {
      showMessage('allowanceMsg', err.message, 'error');
    } finally {
      setLoadingButton(btn, false);
    }
  });

  const deactivateBtn = document.getElementById('deactivateBtn');
  const reactivateBtn = document.getElementById('reactivateBtn');

  deactivateBtn?.addEventListener('click', async () => {
    if (!confirm(`Deactivate ${e.full_name}? They will lose access.`)) return;
    await deactivateEmployee(e.id, ctx.company.id);
    closeModal('empModal');
    await loadEmployees();
  });

  reactivateBtn?.addEventListener('click', async () => {
    await reactivateEmployee(e.id, ctx.company.id);
    closeModal('empModal');
    await loadEmployees();
  });

  openModal('empModal');
}

async function submitInvite() {
  const btn = document.getElementById('sendInviteBtn');
  const name = document.getElementById('inviteName').value.trim();
  const email = document.getElementById('inviteEmail').value.trim();
  const role = document.getElementById('inviteRole').value;
  const department = document.getElementById('inviteDept').value.trim();
  const job_title = document.getElementById('inviteTitle').value.trim();
  const allowance = parseInt(document.getElementById('inviteAllowance').value) || 28;

  if (!name || !email) {
    showMessage('inviteMsg', 'Name and email are required.', 'error');
    return;
  }

  setLoadingButton(btn, true, 'Sending...');
  showMessage('inviteMsg', '', 'info');

  try {
    await sendEmployeeInvite({
      company_id: ctx.company.id,
      company_name: ctx.company.name,
      invited_by: ctx.session.user.id,
      invite_type: 'employee',
      full_name: name,
      email,
      role,
      department: department || null,
      job_title: job_title || null,
      annual_leave_allowance: allowance
    });
    closeModal('inviteModal');
    await loadEmployees();
  } catch (err) {
    showMessage('inviteMsg', err.message, 'error');
  } finally {
    setLoadingButton(btn, false);
  }
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

init();
