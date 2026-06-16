import { requireAdminPageAccess } from '../../shared/guards.js';
import { getEmployeesByCompany, updateEmployee, deactivateEmployee, reactivateEmployee, sendEmployeeInvite, getDepartments, createDepartment, deleteDepartment, deleteEmployee, getLeaveUsedThisYear } from '../../shared/api.js';
import { revealApp, badgeClass, formatDate, showMessage, setLoadingButton, escapeHtml } from '../../shared/ui.js';

let ctx, employees = [], departments = [];
let selectedEmployee = null;

async function init() {
  ctx = await requireAdminPageAccess();
  if (!ctx) return;

  populateSidebar(ctx.company);
  await Promise.all([loadEmployees(), loadDepts()]);
  revealApp();

  document.getElementById('searchInput').addEventListener('input', filterList);
  document.getElementById('statusFilter').addEventListener('change', filterList);
  document.getElementById('deptFilter').addEventListener('change', filterList);

  document.getElementById('inviteBtn').addEventListener('click', () => openModal('inviteModal'));
  document.getElementById('closeInviteModal').addEventListener('click', () => closeModal('inviteModal'));
  document.getElementById('closeInviteModal2').addEventListener('click', () => closeModal('inviteModal'));
  document.getElementById('sendInviteBtn').addEventListener('click', submitInvite);

  document.getElementById('closeEmpModal').addEventListener('click', () => closeModal('empModal'));

  document.getElementById('manageDeptBtn').addEventListener('click', () => {
    renderDeptList();
    openModal('deptModal');
  });
  document.getElementById('closeDeptModal').addEventListener('click', () => closeModal('deptModal'));
  document.getElementById('addDeptBtn').addEventListener('click', addDepartment);
}

function populateSidebar(company) {
  const initials = company.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  document.getElementById('companyAvatar').textContent = initials;
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companyRole').textContent = company.role || 'Admin';
}

async function loadEmployees() {
  employees = await getEmployeesByCompany(ctx.company.id);
  const depts = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();
  const deptFilter = document.getElementById('deptFilter');
  deptFilter.innerHTML = '<option value="">All Departments</option>';
  depts.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    deptFilter.appendChild(opt);
  });
  document.getElementById('empCount').textContent = `${employees.length} employee${employees.length !== 1 ? 's' : ''}`;
  renderList(employees);
}

async function loadDepts() {
  departments = await getDepartments(ctx.company.id);
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
    const empStatus = e.employment_status || e.status || 'active';
    const matchStatus = !status || empStatus === status;
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

  list.innerHTML = items.map(e => {
    const status = e.employment_status || e.status || 'active';
    return `
    <div class="leave-card compact" style="cursor:pointer" data-emp-id="${e.id}">
      <div class="leave-card-top">
        <div class="leave-card-main">
          <p class="leave-card-title">${escapeHtml(e.full_name || e.email || '—')}</p>
          <p class="leave-card-subtitle">${[e.job_title, e.department].filter(Boolean).map(escapeHtml).join(' · ') || 'No details'}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="${badgeClass(e.role || 'employee')}">${escapeHtml(e.role || 'employee')}</span>
          <span class="${badgeClass(status)}">${escapeHtml(status)}</span>
          <span class="muted small">${e.annual_leave_allowance ?? 28}d</span>
        </div>
      </div>
    </div>
  `}).join('');

  list.querySelectorAll('[data-emp-id]').forEach(card => {
    card.addEventListener('click', () => {
      selectedEmployee = employees.find(e => e.id === card.dataset.empId);
      openEmployeeModal(selectedEmployee);
    });
  });
}

async function openEmployeeModal(e) {
  selectedEmployee = e;
  document.getElementById('empModalName').textContent = e.full_name || e.email || '—';
  document.getElementById('empModalSub').textContent = [e.job_title, e.department].filter(Boolean).join(' · ') || 'No details';

  // Switch to view tab by default
  switchEmpTab('view');
  renderViewTab(e);
  renderEditTab(e);

  openModal('empModal');
}

async function renderViewTab(e) {
  const taken = await getLeaveUsedThisYear(e.id, ctx.company.id);
  const allowance = e.annual_leave_allowance ?? 28;
  const status = e.employment_status || e.status || 'active';

  document.getElementById('empViewBody').innerHTML = `
    <div class="modal-grid" style="margin-bottom:18px">
      <div class="detail-tile"><span class="detail-label">Email</span><span class="detail-value">${escapeHtml(e.email || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Phone</span><span class="detail-value">${escapeHtml(e.phone || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Status</span><span class="detail-value"><span class="${badgeClass(status)}">${escapeHtml(status)}</span></span></div>
      <div class="detail-tile"><span class="detail-label">Role</span><span class="detail-value"><span class="${badgeClass(e.role)}">${escapeHtml(e.role || 'employee')}</span></span></div>
      <div class="detail-tile"><span class="detail-label">Department</span><span class="detail-value">${escapeHtml(e.department || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Job Title</span><span class="detail-value">${escapeHtml(e.job_title || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Start Date</span><span class="detail-value">${formatDate(e.start_date)}</span></div>
      <div class="detail-tile"><span class="detail-label">Date of Birth</span><span class="detail-value">${formatDate(e.dob || e.date_of_birth)}</span></div>
      <div class="detail-tile"><span class="detail-label">Allowance</span><span class="detail-value">${allowance} days</span></div>
      <div class="detail-tile"><span class="detail-label">Used (this year)</span><span class="detail-value">${taken} days</span></div>
      <div class="detail-tile"><span class="detail-label">Remaining</span><span class="detail-value">${Math.max(0, allowance - taken)} days</span></div>
    </div>

    <div class="modal-actions" style="margin-top:0;justify-content:flex-start;flex-wrap:wrap;gap:8px">
      ${status === 'active' || status === 'invited'
        ? `<button class="btn btn-secondary" id="archiveEmpBtn">Archive Employee</button>`
        : `<button class="btn btn-success" id="unarchiveEmpBtn">Reactivate</button>`}
      <button class="btn btn-secondary" id="resendInviteBtn">Resend Invite</button>
      <button class="btn btn-danger" id="deleteEmpBtn" style="margin-left:auto">Delete Employee</button>
    </div>
    <p class="form-message" id="empActionMsg"></p>
  `;

  document.getElementById('archiveEmpBtn')?.addEventListener('click', async () => {
    if (!confirm(`Archive ${e.full_name}? They will lose access.`)) return;
    try {
      await deactivateEmployee(e.id, ctx.company.id);
      closeModal('empModal');
      await loadEmployees();
    } catch (err) { showMessage('empActionMsg', err.message, 'error'); }
  });

  document.getElementById('unarchiveEmpBtn')?.addEventListener('click', async () => {
    try {
      await reactivateEmployee(e.id, ctx.company.id);
      closeModal('empModal');
      await loadEmployees();
    } catch (err) { showMessage('empActionMsg', err.message, 'error'); }
  });

  document.getElementById('resendInviteBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('resendInviteBtn');
    setLoadingButton(btn, true, 'Sending...');
    try {
      await sendEmployeeInvite({
        company_id: ctx.company.id,
        company_name: ctx.company.name,
        invited_by: ctx.session.user.id,
        invite_type: 'employee',
        full_name: e.full_name,
        email: e.email,
        role: e.role || 'employee',
        department: e.department || null,
        job_title: e.job_title || null,
        annual_leave_allowance: e.annual_leave_allowance ?? 28
      });
      showMessage('empActionMsg', 'Invite sent!', 'success');
    } catch (err) {
      showMessage('empActionMsg', err.message, 'error');
    } finally {
      setLoadingButton(btn, false);
    }
  });

  document.getElementById('deleteEmpBtn')?.addEventListener('click', async () => {
    if (!confirm(`Permanently delete ${e.full_name}? This cannot be undone and will remove all their leave records.`)) return;
    try {
      await deleteEmployee(e.id, ctx.company.id);
      closeModal('empModal');
      await loadEmployees();
    } catch (err) { showMessage('empActionMsg', err.message, 'error'); }
  });
}

function renderEditTab(e) {
  const deptOptions = departments.map(d =>
    `<option value="${escapeHtml(d.name)}" ${e.department === d.name ? 'selected' : ''}>${escapeHtml(d.name)}</option>`
  ).join('');

  document.getElementById('empEditBody').innerHTML = `
    <div class="profile-edit-grid">
      <div class="field"><label>Full Name</label><input type="text" id="editFullName" value="${escapeHtml(e.full_name || '')}" /></div>
      <div class="field"><label>Email</label><input type="email" id="editEmail" value="${escapeHtml(e.email || '')}" /></div>
      <div class="field"><label>Phone</label><input type="text" id="editPhone" value="${escapeHtml(e.phone || '')}" /></div>
      <div class="field"><label>Job Title</label><input type="text" id="editJobTitle" value="${escapeHtml(e.job_title || '')}" /></div>
      <div class="field"><label>Department</label>
        <select id="editDepartment">
          <option value="">None</option>
          ${deptOptions}
          ${e.department && !departments.find(d => d.name === e.department) ? `<option value="${escapeHtml(e.department)}" selected>${escapeHtml(e.department)}</option>` : ''}
        </select>
      </div>
      <div class="field"><label>Role</label>
        <select id="editRole">
          <option value="employee" ${e.role === 'employee' ? 'selected' : ''}>Employee</option>
          <option value="admin" ${e.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="owner" ${e.role === 'owner' ? 'selected' : ''}>Owner</option>
        </select>
      </div>
      <div class="field"><label>Annual Leave (days)</label><input type="number" id="editAllowance" value="${e.annual_leave_allowance ?? 28}" min="0" max="365" /></div>
      <div class="field"><label>Start Date</label><input type="date" id="editStartDate" value="${e.start_date || ''}" /></div>
      <div class="field"><label>Date of Birth</label><input type="date" id="editDob" value="${e.dob || e.date_of_birth || ''}" /></div>
    </div>
    <p class="form-message" id="editEmpMsg"></p>
    <div class="modal-actions">
      <button class="btn btn-primary" id="saveEmpBtn">Save Changes</button>
    </div>
  `;

  document.getElementById('saveEmpBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveEmpBtn');
    setLoadingButton(btn, true, 'Saving...');
    try {
      const payload = {
        full_name: document.getElementById('editFullName').value.trim() || null,
        email: document.getElementById('editEmail').value.trim() || null,
        phone: document.getElementById('editPhone').value.trim() || null,
        job_title: document.getElementById('editJobTitle').value.trim() || null,
        department: document.getElementById('editDepartment').value || null,
        role: document.getElementById('editRole').value,
        annual_leave_allowance: parseInt(document.getElementById('editAllowance').value) || 28,
        start_date: document.getElementById('editStartDate').value || null,
        dob: document.getElementById('editDob').value || null
      };
      const updated = await updateEmployee(e.id, ctx.company.id, payload);
      Object.assign(selectedEmployee, updated);
      Object.assign(e, updated);
      document.getElementById('empModalName').textContent = updated.full_name || updated.email || '—';
      showMessage('editEmpMsg', 'Saved successfully.', 'success');
      await loadEmployees();
    } catch (err) {
      showMessage('editEmpMsg', err.message, 'error');
    } finally {
      setLoadingButton(btn, false);
    }
  });
}

function switchEmpTab(tab) {
  document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.toggle('active', p.id === `emp${tab.charAt(0).toUpperCase() + tab.slice(1)}Body`));
  
  // wire tab buttons
  document.querySelectorAll('.modal-tab-btn').forEach(b => {
    b.onclick = () => switchEmpTab(b.dataset.tab);
  });
}

// ── Department management ─────────────────────────────────────────────

function renderDeptList() {
  const list = document.getElementById('deptList');
  if (!departments.length) {
    list.innerHTML = `<p class="muted small">No departments yet.</p>`;
    return;
  }
  list.innerHTML = departments.map(d => `
    <div class="mini-list-row">
      <span>${escapeHtml(d.name)}</span>
      <button class="btn btn-danger icon-btn" style="padding:4px 8px!important;font-size:0.8rem" data-dept-id="${d.id}">Delete</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-dept-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete department "${departments.find(d => d.id === btn.dataset.deptId)?.name}"?`)) return;
      try {
        await deleteDepartment(btn.dataset.deptId, ctx.company.id);
        await loadDepts();
        renderDeptList();
        await loadEmployees();
      } catch (err) { showMessage('deptMsg', err.message, 'error'); }
    });
  });
}

async function addDepartment() {
  const input = document.getElementById('newDeptName');
  const name = input.value.trim();
  if (!name) return;
  try {
    await createDepartment(ctx.company.id, name);
    input.value = '';
    await loadDepts();
    renderDeptList();
    await loadEmployees();
    showMessage('deptMsg', `Department "${name}" created.`, 'success');
  } catch (err) { showMessage('deptMsg', err.message, 'error'); }
}

async function submitInvite() {
  const btn = document.getElementById('sendInviteBtn');
  const name = document.getElementById('inviteName').value.trim();
  const email = document.getElementById('inviteEmail').value.trim();
  const role = document.getElementById('inviteRole').value;
  const department = document.getElementById('inviteDept').value.trim();
  const job_title = document.getElementById('inviteTitle').value.trim();
  const allowance = parseInt(document.getElementById('inviteAllowance').value) || 28;

  if (!name || !email) { showMessage('inviteMsg', 'Name and email are required.', 'error'); return; }

  setLoadingButton(btn, true, 'Sending...');
  showMessage('inviteMsg', '', 'info');

  try {
    await sendEmployeeInvite({
      company_id: ctx.company.id,
      company_name: ctx.company.name,
      invited_by: ctx.session.user.id,
      invite_type: 'employee',
      full_name: name, email, role,
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
