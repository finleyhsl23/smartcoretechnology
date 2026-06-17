import { requireAdminPageAccess } from '../../shared/guards.js';
import {
  getEmployeesByCompany, updateEmployee, deactivateEmployee, reactivateEmployee,
  sendEmployeeInvite, getDepartments, createDepartment, deleteDepartment,
  deleteEmployee, getLeaveUsedThisYear,
  getShiftPatterns, createShiftPattern, deleteShiftPattern,
  getEmployeeAuthorisers, setEmployeeAuthorisers, searchAdminsAndOwners,
  createEmployeeFull,
  getOnboardingFieldSettings, updateOnboardingFieldSettings
} from '../../shared/api.js';
import { revealApp, badgeClass, formatDate, showMessage, setLoadingButton, escapeHtml } from '../../shared/ui.js';

let ctx, employees = [], departments = [];
let selectedEmployee = null;

// ── Multi-step "Add Employee" state ─────────────────────────────────────────
let addEmpState = {};
let addEmpStep = 1;
const ADD_EMP_STEPS = 5;

// ── Shift pattern sub-modal state ────────────────────────────────────────────
let shiftPatterns = [];
let addEmpShiftBackdrop = null;

// ── Authoriser search debounce ────────────────────────────────────────────────
let authoriserDebounceTimer = null;

async function init() {
  ctx = await requireAdminPageAccess();
  if (!ctx) return;

  populateSidebar(ctx.company);
  await Promise.all([loadEmployees(), loadDepts()]);
  revealApp();

  document.getElementById('searchInput').addEventListener('input', filterList);
  document.getElementById('statusFilter').addEventListener('change', filterList);
  document.getElementById('deptFilter').addEventListener('change', filterList);

  // Wire Add Employee button
  const addEmpBtn = document.getElementById('addEmpBtn') || document.getElementById('inviteBtn');
  if (addEmpBtn) {
    addEmpBtn.addEventListener('click', openAddEmployeeModal);
  }

  document.getElementById('closeEmpModal').addEventListener('click', () => closeModal('empModal'));

  document.getElementById('manageDeptBtn').addEventListener('click', () => {
    renderDeptList();
    openModal('deptModal');
  });
  document.getElementById('closeDeptModal').addEventListener('click', () => closeModal('deptModal'));
  document.getElementById('addDeptBtn').addEventListener('click', addDepartment);

  // Inject topbar button for onboarding questions
  injectOnboardingQuestionsBtn();

  // Inject multi-step add-employee modal into DOM
  injectAddEmpModal();

  // Inject onboarding questions modal
  injectOnboardingModal();
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
      e.work_email?.toLowerCase().includes(search) ||
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
          <p class="leave-card-title">${escapeHtml(e.full_name || e.work_email || e.email || '—')}</p>
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

// ── Employee detail modal ─────────────────────────────────────────────────────

async function openEmployeeModal(e) {
  selectedEmployee = e;
  document.getElementById('empModalName').textContent = e.full_name || e.work_email || e.email || '—';
  document.getElementById('empModalSub').textContent = [e.job_title, e.department].filter(Boolean).join(' · ') || 'No details';

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
      <div class="detail-tile"><span class="detail-label">Work Email</span><span class="detail-value">${escapeHtml(e.work_email || e.email || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Personal Email</span><span class="detail-value">${escapeHtml(e.personal_email || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Phone</span><span class="detail-value">${escapeHtml(e.personal_phone || e.phone || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Status</span><span class="detail-value"><span class="${badgeClass(status)}">${escapeHtml(status)}</span></span></div>
      <div class="detail-tile"><span class="detail-label">Role</span><span class="detail-value"><span class="${badgeClass(e.role)}">${escapeHtml(e.role || 'employee')}</span></span></div>
      <div class="detail-tile"><span class="detail-label">Employment Type</span><span class="detail-value">${escapeHtml(e.employment_type || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Department</span><span class="detail-value">${escapeHtml(e.department || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Job Title</span><span class="detail-value">${escapeHtml(e.job_title || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Start Date</span><span class="detail-value">${formatDate(e.start_date)}</span></div>
      <div class="detail-tile"><span class="detail-label">Date of Birth</span><span class="detail-value">${formatDate(e.dob || e.date_of_birth)}</span></div>
      <div class="detail-tile"><span class="detail-label">Notice Period</span><span class="detail-value">${escapeHtml(e.notice_period || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Allowance</span><span class="detail-value">${allowance} days</span></div>
      <div class="detail-tile"><span class="detail-label">Used (this year)</span><span class="detail-value">${taken} days</span></div>
      <div class="detail-tile"><span class="detail-label">Remaining</span><span class="detail-value">${Math.max(0, allowance - taken)} days</span></div>
      ${e.employee_code ? `<div class="detail-tile"><span class="detail-label">Employee Code</span><span class="detail-value">${escapeHtml(e.employee_code)}</span></div>` : ''}
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
        email: e.work_email || e.email,
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
    `<option value="${d.id}" ${e.department_id === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`
  ).join('');

  const currentYear = new Date().getFullYear();

  document.getElementById('empEditBody').innerHTML = `
    <div class="profile-edit-grid">
      <div class="field"><label>Full Name</label><input type="text" id="editFullName" value="${escapeHtml(e.full_name || '')}" /></div>
      <div class="field"><label>Work Email</label><input type="email" id="editWorkEmail" value="${escapeHtml(e.work_email || e.email || '')}" /></div>
      <div class="field"><label>Personal Email</label><input type="email" id="editPersonalEmail" value="${escapeHtml(e.personal_email || '')}" /></div>
      <div class="field"><label>Personal Phone</label><input type="text" id="editPersonalPhone" value="${escapeHtml(e.personal_phone || e.phone || '')}" /></div>
      <div class="field"><label>Job Title</label><input type="text" id="editJobTitle" value="${escapeHtml(e.job_title || '')}" /></div>
      <div class="field"><label>Employment Type</label>
        <select id="editEmploymentType">
          <option value="">—</option>
          <option value="Full Time" ${e.employment_type === 'Full Time' ? 'selected' : ''}>Full Time</option>
          <option value="Part Time" ${e.employment_type === 'Part Time' ? 'selected' : ''}>Part Time</option>
          <option value="Other" ${e.employment_type && !['Full Time','Part Time'].includes(e.employment_type) ? 'selected' : ''}>Other</option>
        </select>
      </div>
      <div class="field" id="editEmploymentTypeOtherWrap" style="${e.employment_type && !['Full Time','Part Time'].includes(e.employment_type) ? '' : 'display:none'}">
        <label>Specify Employment Type</label>
        <input type="text" id="editEmploymentTypeOther" value="${escapeHtml(e.employment_type && !['Full Time','Part Time'].includes(e.employment_type) ? e.employment_type : '')}" />
      </div>
      <div class="field"><label>Notice Period</label><input type="text" id="editNoticePeriod" value="${escapeHtml(e.notice_period || '')}" placeholder="e.g. 1 month" /></div>
      <div class="field"><label>Department</label>
        <select id="editDepartment">
          <option value="">None</option>
          ${deptOptions}
        </select>
      </div>
      <div class="field"><label>Role</label>
        <select id="editRole">
          <option value="employee" ${e.role === 'employee' ? 'selected' : ''}>Employee</option>
          <option value="admin" ${e.role === 'admin' ? 'selected' : ''}>Admin</option>
          ${ctx.profile?.role === 'owner' ? `<option value="owner" ${e.role === 'owner' ? 'selected' : ''}>Owner</option>` : ''}
        </select>
      </div>
      <div class="field"><label>Annual Leave (days)</label><input type="number" id="editAllowance" value="${e.annual_leave_allowance ?? 28}" min="0" max="365" /></div>
      <div class="field"><label>Start Date</label><input type="date" id="editStartDate" value="${e.start_date || ''}" /></div>
      <div class="field"><label>Date of Birth</label><input type="date" id="editDob" value="${e.dob || e.date_of_birth || ''}" /></div>
      <div class="field" style="grid-column:1/-1">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="editOverrideToggle" ${e.override_allowance_this_year != null ? 'checked' : ''} />
          Override allowance for ${currentYear} only
        </label>
      </div>
      <div class="field" id="editOverrideWrap" style="${e.override_allowance_this_year != null ? '' : 'display:none'}">
        <label>Override days (0.5 steps)</label>
        <input type="number" id="editOverrideDays" value="${e.override_allowance_this_year ?? ''}" step="0.5" min="0" max="365" />
      </div>
    </div>
    <p class="form-message" id="editEmpMsg"></p>
    <div class="modal-actions">
      <button class="btn btn-primary" id="saveEmpBtn">Save Changes</button>
    </div>
  `;

  document.getElementById('editEmploymentType').addEventListener('change', function () {
    document.getElementById('editEmploymentTypeOtherWrap').style.display = this.value === 'Other' ? '' : 'none';
  });

  document.getElementById('editOverrideToggle').addEventListener('change', function () {
    document.getElementById('editOverrideWrap').style.display = this.checked ? '' : 'none';
  });

  document.getElementById('saveEmpBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveEmpBtn');
    setLoadingButton(btn, true, 'Saving...');
    try {
      const empTypeVal = document.getElementById('editEmploymentType').value;
      const empType = empTypeVal === 'Other'
        ? (document.getElementById('editEmploymentTypeOther').value.trim() || 'Other')
        : empTypeVal;

      const overrideChecked = document.getElementById('editOverrideToggle').checked;
      const overrideDays = overrideChecked ? (parseFloat(document.getElementById('editOverrideDays').value) || 0) : null;

      const deptId = document.getElementById('editDepartment').value || null;
      const deptName = deptId ? (departments.find(d => d.id === deptId)?.name || null) : null;

      const payload = {
        full_name: document.getElementById('editFullName').value.trim() || null,
        work_email: document.getElementById('editWorkEmail').value.trim() || null,
        personal_email: document.getElementById('editPersonalEmail').value.trim() || null,
        personal_phone: document.getElementById('editPersonalPhone').value.trim() || null,
        job_title: document.getElementById('editJobTitle').value.trim() || null,
        employment_type: empType || null,
        notice_period: document.getElementById('editNoticePeriod').value.trim() || null,
        department_id: deptId,
        department: deptName,
        role: document.getElementById('editRole').value,
        annual_leave_allowance: parseInt(document.getElementById('editAllowance').value) || 28,
        start_date: document.getElementById('editStartDate').value || null,
        dob: document.getElementById('editDob').value || null,
        override_allowance_this_year: overrideDays,
        override_allowance_calculation: overrideChecked
      };
      const updated = await updateEmployee(e.id, ctx.company.id, payload);
      Object.assign(selectedEmployee, updated);
      Object.assign(e, updated);
      document.getElementById('empModalName').textContent = updated.full_name || updated.work_email || updated.email || '—';
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
  document.querySelectorAll('#empModal .modal-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('#empModal .modal-tab-panel').forEach(p => p.classList.toggle('active', p.id === `emp${tab.charAt(0).toUpperCase() + tab.slice(1)}Body`));

  document.querySelectorAll('#empModal .modal-tab-btn').forEach(b => {
    b.onclick = () => switchEmpTab(b.dataset.tab);
  });
}

// ── Department management modal ───────────────────────────────────────────────

function renderDeptList() {
  const list = document.getElementById('deptList');
  if (!departments.length) {
    list.innerHTML = `<p class="muted small">No departments yet.</p>`;
    return;
  }
  list.innerHTML = departments.map(d => {
    const count = employees.filter(e => e.department_id === d.id || e.department === d.name).length;
    return `
    <div class="mini-list-row">
      <span>${escapeHtml(d.name)} <span class="muted small">(${count} employee${count !== 1 ? 's' : ''})</span></span>
      <button class="btn btn-danger icon-btn" style="padding:4px 8px!important;font-size:0.8rem" data-dept-id="${d.id}" data-dept-name="${escapeHtml(d.name)}" data-dept-count="${count}">Delete</button>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-dept-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deptId;
      const name = btn.dataset.deptName;
      const count = parseInt(btn.dataset.deptCount, 10);

      if (count === 0) {
        if (!confirm(`Delete department "${name}"?`)) return;
        try {
          await deleteDepartment(id, ctx.company.id);
          await loadDepts();
          renderDeptList();
          await loadEmployees();
        } catch (err) { showMessage('deptMsg', err.message, 'error'); }
        return;
      }

      // Employees assigned — show reassignment UI
      const affected = employees.filter(e => e.department_id === id || e.department === name);
      if (!confirm(`Are you sure? ${count} employee(s) are still assigned to this department.`)) return;

      // Build reassignment UI inside deptModal
      const otherDepts = departments.filter(d => d.id !== id);
      const reassignHtml = `
        <div id="deptReassignPanel" style="margin-top:16px;border-top:1px solid var(--border);padding-top:12px">
          <p class="muted small" style="margin-bottom:10px">Reassign employees before deleting:</p>
          ${affected.map(emp => `
            <div class="mini-list-row" style="gap:8px;flex-wrap:wrap">
              <span style="flex:1;min-width:120px">${escapeHtml(emp.full_name || emp.work_email || emp.email || '—')}</span>
              <select data-reassign-emp="${emp.id}" style="flex:1;min-width:120px">
                <option value="">— No department —</option>
                ${otherDepts.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}
              </select>
            </div>`).join('')}
          <div class="modal-actions" style="margin-top:12px">
            <button class="btn btn-secondary" id="cancelReassignBtn">Cancel</button>
            <button class="btn btn-primary" id="confirmReassignBtn">Confirm &amp; Delete Department</button>
          </div>
          <p class="form-message" id="reassignMsg"></p>
        </div>`;

      const existing = document.getElementById('deptReassignPanel');
      if (existing) existing.remove();
      list.insertAdjacentHTML('afterend', reassignHtml);

      document.getElementById('cancelReassignBtn').addEventListener('click', () => {
        document.getElementById('deptReassignPanel')?.remove();
      });

      document.getElementById('confirmReassignBtn').addEventListener('click', async () => {
        const cBtn = document.getElementById('confirmReassignBtn');
        setLoadingButton(cBtn, true, 'Saving...');
        try {
          const selects = document.querySelectorAll('[data-reassign-emp]');
          await Promise.all(Array.from(selects).map(sel => {
            const newDeptId = sel.value || null;
            const newDeptName = newDeptId ? (departments.find(d => d.id === newDeptId)?.name || null) : null;
            return updateEmployee(sel.dataset.reassignEmp, ctx.company.id, {
              department_id: newDeptId,
              department: newDeptName
            });
          }));
          await deleteDepartment(id, ctx.company.id);
          await loadDepts();
          await loadEmployees();
          document.getElementById('deptReassignPanel')?.remove();
          renderDeptList();
          showMessage('deptMsg', `Department "${name}" deleted.`, 'success');
        } catch (err) {
          showMessage('reassignMsg', err.message, 'error');
        } finally {
          setLoadingButton(cBtn, false);
        }
      });
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

// ── Onboarding questions button & modal ───────────────────────────────────────

function injectOnboardingQuestionsBtn() {
  // Button is already in HTML as #onboardingSettingsBtn; just wire it up
  const btn = document.getElementById('onboardingSettingsBtn');
  if (btn) btn.addEventListener('click', openOnboardingModal);
}

function injectOnboardingModal() {
  const ONBOARDING_FIELDS = [
    { key: 'preferred_name', label: 'Preferred Name' },
    { key: 'pronouns', label: 'Pronouns' },
    { key: 'personal_phone', label: 'Personal Phone' },
    { key: 'date_of_birth', label: 'Date of Birth' },
    { key: 'national_insurance_number', label: 'National Insurance Number' },
    { key: 'bank_account_details', label: 'Bank Account Details' },
    { key: 'address', label: 'Address' },
    { key: 'gender', label: 'Gender' },
    { key: 'dietary_requirements', label: 'Dietary Requirements' },
    { key: 'accessibility_needs', label: 'Accessibility Needs' },
    { key: 'student_loan_status', label: 'Student Loan Status' },
    { key: 'tax_code', label: 'Tax Code' },
    { key: 'emergency_contact_2', label: 'Emergency Contact 2' },
  ];
  window._onboardingFields = ONBOARDING_FIELDS;

  const el = document.createElement('div');
  el.className = 'modal-backdrop hidden';
  el.id = 'onboardingModal';
  el.innerHTML = `
    <div class="modal-card glass-card narrow">
      <div class="modal-header">
        <div><h2>Onboarding Questions</h2><p class="muted">Set which optional fields are required during onboarding.</p></div>
        <button class="btn btn-secondary icon-btn" id="closeOnboardingModal">✕</button>
      </div>
      <div id="onboardingFieldsList" style="margin-bottom:16px"></div>
      <p class="form-message" id="onboardingMsg"></p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="cancelOnboardingBtn">Cancel</button>
        <button class="btn btn-primary" id="saveOnboardingBtn">Save Settings</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  document.getElementById('closeOnboardingModal').addEventListener('click', () => closeModal('onboardingModal'));
  document.getElementById('cancelOnboardingBtn').addEventListener('click', () => closeModal('onboardingModal'));
  document.getElementById('saveOnboardingBtn').addEventListener('click', saveOnboardingSettings);
}

async function openOnboardingModal() {
  const fields = window._onboardingFields;
  let settings = [];
  try {
    settings = await getOnboardingFieldSettings(ctx.company.id);
  } catch (_) {}

  const settingsMap = {};
  settings.forEach(s => { settingsMap[s.field_key] = s.is_required; });

  const list = document.getElementById('onboardingFieldsList');
  list.innerHTML = fields.map(f => {
    const isRequired = settingsMap[f.key] === true;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border,rgba(255,255,255,0.08))">
        <span>${escapeHtml(f.label)}</span>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="badge-${isRequired ? 'warning' : 'neutral'} small" id="onboardBadge_${f.key}">${isRequired ? 'Required' : 'Optional'}</span>
          <label class="toggle-label" style="display:flex;align-items:center;gap:6px;cursor:pointer">
            <input type="checkbox" class="onboarding-toggle" data-field="${f.key}" ${isRequired ? 'checked' : ''} />
            <span class="muted small">Required</span>
          </label>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.onboarding-toggle').forEach(cb => {
    cb.addEventListener('change', function () {
      const badge = document.getElementById(`onboardBadge_${this.dataset.field}`);
      if (badge) {
        badge.textContent = this.checked ? 'Required' : 'Optional';
        badge.className = `badge-${this.checked ? 'warning' : 'neutral'} small`;
      }
    });
  });

  showMessage('onboardingMsg', '', 'info');
  openModal('onboardingModal');
}

async function saveOnboardingSettings() {
  const btn = document.getElementById('saveOnboardingBtn');
  setLoadingButton(btn, true, 'Saving...');
  try {
    const toggles = document.querySelectorAll('.onboarding-toggle');
    const settings = Array.from(toggles).map(cb => ({
      field_key: cb.dataset.field,
      is_required: cb.checked
    }));
    await updateOnboardingFieldSettings(ctx.company.id, settings);
    showMessage('onboardingMsg', 'Settings saved.', 'success');
  } catch (err) {
    showMessage('onboardingMsg', err.message, 'error');
  } finally {
    setLoadingButton(btn, false);
  }
}

// ── Multi-step "Add Employee" modal ──────────────────────────────────────────

function resetAddEmpState() {
  addEmpState = {
    fullName: '',
    jobTitle: '',
    workEmail: '',
    personalEmail: '',
    personalPhone: '',
    employmentType: '',
    employmentTypeOther: '',
    noticePeriod: '',
    departmentId: null,
    departmentName: '',
    role: 'employee',
    authorisers: [],    // [{id, full_name, work_email, role}]
    startDate: '',
    annualLeaveAllowance: 28,
    overrideAllowance: false,
    overrideDays: null,
    shiftPattern: null,   // {id, name} or null
    shiftPatternName: ''
  };
  addEmpStep = 1;
}

function injectAddEmpModal() {
  const el = document.createElement('div');
  el.className = 'modal-backdrop hidden';
  el.id = 'addEmpModal';
  el.innerHTML = `
    <div class="modal-card glass-card" style="max-width:600px;width:100%">
      <div class="modal-header">
        <div>
          <h2 id="addEmpModalTitle">Add Employee</h2>
          <p class="muted" id="addEmpStepIndicator">Step 1 of ${ADD_EMP_STEPS}</p>
        </div>
        <button class="btn btn-secondary icon-btn" id="closeAddEmpModal">✕</button>
      </div>
      <div id="addEmpStepDots" style="display:flex;gap:6px;margin-bottom:20px;padding:0 2px">
        ${Array.from({length: ADD_EMP_STEPS}, (_, i) =>
          `<div class="step-dot" data-step="${i+1}" style="width:32px;height:4px;border-radius:2px;background:var(--border,rgba(255,255,255,0.15));transition:background .2s"></div>`
        ).join('')}
      </div>
      <div id="addEmpStepContent" class="form-stack"></div>
      <div class="modal-actions" style="margin-top:20px" id="addEmpModalActions">
        <button class="btn btn-secondary" id="addEmpBackBtn" style="display:none">Back</button>
        <span style="flex:1"></span>
        <button class="btn btn-primary" id="addEmpNextBtn">Next</button>
      </div>
      <p class="form-message" id="addEmpMsg"></p>
    </div>`;
  document.body.appendChild(el);

  document.getElementById('closeAddEmpModal').addEventListener('click', () => closeModal('addEmpModal'));
  document.getElementById('addEmpBackBtn').addEventListener('click', addEmpBack);
  document.getElementById('addEmpNextBtn').addEventListener('click', addEmpNext);
}

function openAddEmployeeModal() {
  resetAddEmpState();
  renderAddEmpStep();
  openModal('addEmpModal');
}

function updateAddEmpNav() {
  document.getElementById('addEmpStepIndicator').textContent = `Step ${addEmpStep} of ${ADD_EMP_STEPS}`;
  document.getElementById('addEmpBackBtn').style.display = addEmpStep > 1 ? '' : 'none';

  const nextBtn = document.getElementById('addEmpNextBtn');
  if (addEmpStep === ADD_EMP_STEPS) {
    nextBtn.style.display = 'none';
  } else {
    nextBtn.style.display = '';
    nextBtn.textContent = addEmpStep < ADD_EMP_STEPS - 1 ? 'Next' : 'Next';
  }

  // Update step dots
  document.querySelectorAll('#addEmpStepDots .step-dot').forEach(dot => {
    const s = parseInt(dot.dataset.step, 10);
    dot.style.background = s === addEmpStep
      ? 'var(--accent, #6366f1)'
      : s < addEmpStep
        ? 'var(--success, #22c55e)'
        : 'var(--border, rgba(255,255,255,0.15))';
  });
}

function renderAddEmpStep() {
  updateAddEmpNav();
  showMessage('addEmpMsg', '', 'info');
  const content = document.getElementById('addEmpStepContent');

  switch (addEmpStep) {
    case 1: renderAddEmpStep1(content); break;
    case 2: renderAddEmpStep2(content); break;
    case 3: renderAddEmpStep3(content); break;
    case 4: renderAddEmpStep4(content); break;
    case 5: renderAddEmpStep5(content); break;
  }
}

// Step 1 – Personal & Contact Info
function renderAddEmpStep1(content) {
  document.getElementById('addEmpModalTitle').textContent = 'Personal & Contact Info';
  content.innerHTML = `
    <div class="field"><label>Full Name <span style="color:var(--error,#ef4444)">*</span></label>
      <input type="text" id="ae_fullName" value="${escapeHtml(addEmpState.fullName)}" placeholder="Jane Smith" />
    </div>
    <div class="field"><label>Job Title <span style="color:var(--error,#ef4444)">*</span></label>
      <input type="text" id="ae_jobTitle" value="${escapeHtml(addEmpState.jobTitle)}" placeholder="e.g. Account Manager" />
    </div>
    <div class="field"><label>Work Email <span style="color:var(--error,#ef4444)">*</span></label>
      <input type="email" id="ae_workEmail" value="${escapeHtml(addEmpState.workEmail)}" placeholder="jane@company.com" />
    </div>
    <div class="field"><label>Personal Email</label>
      <input type="email" id="ae_personalEmail" value="${escapeHtml(addEmpState.personalEmail)}" placeholder="jane@personal.com" />
    </div>
    <div class="field"><label>Personal Phone</label>
      <input type="text" id="ae_personalPhone" value="${escapeHtml(addEmpState.personalPhone)}" placeholder="+44 7700 000000" />
    </div>
    <div class="field"><label>Employment Type</label>
      <div class="custom-select" id="ae_empTypeSelect" style="position:relative">
        <button type="button" class="btn btn-secondary" id="ae_empTypeTrigger" style="width:100%;text-align:left;justify-content:space-between">
          <span id="ae_empTypeLabel">${escapeHtml(addEmpState.employmentType || 'Select...')}</span>
          <span>▾</span>
        </button>
        <div id="ae_empTypeDropdown" class="hidden" style="position:absolute;top:100%;left:0;right:0;z-index:100;background:var(--card-bg,#1e1e2e);border:1px solid var(--border,rgba(255,255,255,0.15));border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.3)">
          ${['Full Time','Part Time','Other'].map(opt =>
            `<div class="dropdown-item" data-value="${opt}" style="padding:10px 14px;cursor:pointer;transition:background .15s">${opt}</div>`
          ).join('')}
        </div>
      </div>
    </div>
    <div class="field" id="ae_empTypeOtherWrap" style="${addEmpState.employmentType === 'Other' ? '' : 'display:none'}">
      <label>Specify Employment Type</label>
      <input type="text" id="ae_empTypeOther" value="${escapeHtml(addEmpState.employmentTypeOther)}" placeholder="e.g. Freelance" />
    </div>
    <div class="field"><label>Notice Period</label>
      <input type="text" id="ae_noticePeriod" value="${escapeHtml(addEmpState.noticePeriod)}" placeholder="e.g. 1 month" />
    </div>`;

  // Custom dropdown logic
  const trigger = document.getElementById('ae_empTypeTrigger');
  const dropdown = document.getElementById('ae_empTypeDropdown');
  trigger.addEventListener('click', () => dropdown.classList.toggle('hidden'));
  dropdown.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('mouseenter', () => item.style.background = 'var(--hover,rgba(255,255,255,0.07))');
    item.addEventListener('mouseleave', () => item.style.background = '');
    item.addEventListener('click', () => {
      const val = item.dataset.value;
      document.getElementById('ae_empTypeLabel').textContent = val;
      addEmpState.employmentType = val;
      dropdown.classList.add('hidden');
      document.getElementById('ae_empTypeOtherWrap').style.display = val === 'Other' ? '' : 'none';
    });
  });
  document.addEventListener('click', function closeEmpTypeDd(ev) {
    if (!document.getElementById('ae_empTypeSelect')?.contains(ev.target)) {
      dropdown.classList.add('hidden');
      document.removeEventListener('click', closeEmpTypeDd);
    }
  });
}

// Step 2 – Role & Department
function renderAddEmpStep2(content) {
  document.getElementById('addEmpModalTitle').textContent = 'Role & Department';
  const isOwner = ctx.profile?.role === 'owner';

  content.innerHTML = `
    <div class="field">
      <label>Department</label>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div id="ae_deptChip" style="flex:1">
          ${addEmpState.departmentName
            ? `<span class="badge-neutral" style="padding:6px 12px;border-radius:20px">${escapeHtml(addEmpState.departmentName)}</span>`
            : `<span class="muted small">No department selected</span>`}
        </div>
        <button type="button" class="btn btn-secondary" id="ae_changeDeptBtn" style="white-space:nowrap">Change / Select</button>
      </div>
      <div style="margin-top:6px">
        <a href="#" class="muted small" id="ae_manageDeptLink" style="text-decoration:underline">Manage Departments</a>
      </div>
    </div>

    <div class="field">
      <label>Role</label>
      <div style="display:flex;flex-direction:column;gap:8px" id="ae_roleCards">
        ${buildRoleCard('employee', 'Employee', 'Normal permissions', addEmpState.role)}
        ${buildRoleCard('admin', 'Admin', 'Can manage leave, invite employees (not as owner)', addEmpState.role)}
        ${isOwner ? buildRoleCard('owner', 'Owner', 'Full control', addEmpState.role) : ''}
      </div>
    </div>

    <div class="field">
      <label>Authorising Users <span class="muted small">(up to 5)</span></label>
      <input type="text" id="ae_authoriserSearch" placeholder="Search admins &amp; owners..." ${addEmpState.authorisers.length >= 5 ? 'disabled' : ''} />
      <div id="ae_authoriserResults" class="hidden" style="position:relative;z-index:50">
        <div style="position:absolute;top:2px;left:0;right:0;background:var(--card-bg,#1e1e2e);border:1px solid var(--border,rgba(255,255,255,0.15));border-radius:8px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,0.3)" id="ae_authoriserDropdown"></div>
      </div>
      <div id="ae_authoriserList" style="margin-top:8px;display:flex;flex-direction:column;gap:6px">
        ${addEmpState.authorisers.map(a => buildAuthoriserChip(a)).join('')}
      </div>
      ${addEmpState.authorisers.length > 0 && addEmpState.authorisers.length < 5
        ? `<p class="muted small" style="margin-top:6px">Add Another Authoriser?</p>` : ''}
    </div>`;

  // Role card selection
  document.querySelectorAll('#ae_roleCards .role-card').forEach(card => {
    card.addEventListener('click', () => {
      addEmpState.role = card.dataset.role;
      document.querySelectorAll('#ae_roleCards .role-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.role === addEmpState.role);
        c.style.borderColor = c.dataset.role === addEmpState.role ? 'var(--accent,#6366f1)' : 'var(--border,rgba(255,255,255,0.15))';
      });
    });
  });

  // Department buttons
  document.getElementById('ae_changeDeptBtn').addEventListener('click', () => openDeptPickerModal());
  document.getElementById('ae_manageDeptLink').addEventListener('click', e => {
    e.preventDefault();
    renderDeptList();
    openModal('deptModal');
  });

  // Authoriser search
  const searchInput = document.getElementById('ae_authoriserSearch');
  searchInput?.addEventListener('input', () => {
    clearTimeout(authoriserDebounceTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      document.getElementById('ae_authoriserResults').classList.add('hidden');
      return;
    }
    authoriserDebounceTimer = setTimeout(async () => {
      try {
        const results = await searchAdminsAndOwners(ctx.company.id, q);
        const alreadyIds = addEmpState.authorisers.map(a => a.id);
        const filtered = results.filter(r => !alreadyIds.includes(r.id));
        const dd = document.getElementById('ae_authoriserDropdown');
        const wrap = document.getElementById('ae_authoriserResults');
        if (!filtered.length) {
          dd.innerHTML = `<p class="muted small" style="padding:10px 14px">No results found.</p>`;
        } else {
          dd.innerHTML = filtered.map(r =>
            `<div class="dropdown-item" data-auth-id="${r.id}" style="padding:10px 14px;cursor:pointer;display:flex;gap:8px;align-items:center">
              <span>${escapeHtml(r.full_name || r.work_email || r.email || '—')}</span>
              <span class="${badgeClass(r.role)}" style="font-size:0.7rem">${escapeHtml(r.role)}</span>
            </div>`
          ).join('');
          dd.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('mouseenter', () => item.style.background = 'var(--hover,rgba(255,255,255,0.07))');
            item.addEventListener('mouseleave', () => item.style.background = '');
            item.addEventListener('click', () => {
              const emp = results.find(r => r.id === item.dataset.authId);
              if (emp && addEmpState.authorisers.length < 5) {
                addEmpState.authorisers.push(emp);
                searchInput.value = '';
                wrap.classList.add('hidden');
                refreshAuthoriserList();
              }
            });
          });
        }
        wrap.classList.remove('hidden');
      } catch (_) {}
    }, 300);
  });

  document.addEventListener('click', function closeAuthDd(ev) {
    const wrap = document.getElementById('ae_authoriserResults');
    if (wrap && !wrap.parentElement?.contains(ev.target) && ev.target !== searchInput) {
      wrap.classList.add('hidden');
    }
  });
}

function buildRoleCard(value, label, desc, selected) {
  const isSelected = selected === value;
  return `
    <div class="role-card ${isSelected ? 'selected' : ''}" data-role="${value}"
      style="padding:12px 16px;border-radius:8px;border:2px solid ${isSelected ? 'var(--accent,#6366f1)' : 'var(--border,rgba(255,255,255,0.15))'};cursor:pointer;transition:border-color .2s;display:flex;flex-direction:column;gap:2px">
      <span style="font-weight:600">${escapeHtml(label)}</span>
      <span class="muted small">${escapeHtml(desc)}</span>
    </div>`;
}

function buildAuthoriserChip(a) {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--hover,rgba(255,255,255,0.05));border-radius:8px;border:1px solid var(--border,rgba(255,255,255,0.1))">
      <span>${escapeHtml(a.full_name || a.work_email || a.email || '—')} <span class="${badgeClass(a.role)}" style="font-size:0.7rem">${escapeHtml(a.role)}</span></span>
      <button type="button" class="btn btn-danger icon-btn" data-remove-auth="${a.id}" style="padding:2px 8px!important;font-size:0.75rem">✕</button>
    </div>`;
}

function refreshAuthoriserList() {
  const list = document.getElementById('ae_authoriserList');
  if (!list) return;
  list.innerHTML = addEmpState.authorisers.map(a => buildAuthoriserChip(a)).join('');
  list.querySelectorAll('[data-remove-auth]').forEach(btn => {
    btn.addEventListener('click', () => {
      addEmpState.authorisers = addEmpState.authorisers.filter(a => a.id !== btn.dataset.removeAuth);
      refreshAuthoriserList();
      const searchInput = document.getElementById('ae_authoriserSearch');
      if (searchInput) searchInput.disabled = addEmpState.authorisers.length >= 5;

      const addAnotherMsg = document.querySelector('#addEmpStepContent .add-another-msg');
      // re-render hint
      const hint = document.querySelector('#addEmpStepContent > .field:last-child > .muted.small');
      if (addEmpState.authorisers.length > 0 && addEmpState.authorisers.length < 5 && hint) {
        hint.textContent = 'Add Another Authoriser?';
      }
    });
  });
}

// Department picker sub-modal (from Step 2)
function openDeptPickerModal() {
  // Build a simple department picker inside a mini overlay
  const existing = document.getElementById('ae_deptPickerOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'ae_deptPickerOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';
  overlay.innerHTML = `
    <div class="modal-card glass-card narrow" style="position:relative;z-index:301;max-height:80vh;overflow-y:auto">
      <div class="modal-header">
        <div><h2>Select Department</h2></div>
        <button class="btn btn-secondary icon-btn" id="ae_closeDeptPicker">✕</button>
      </div>
      <div id="ae_deptPickerList">
        <div style="padding:6px 0;margin-bottom:8px">
          <button class="btn btn-secondary btn-block" data-pick-dept="" data-pick-dept-name="">
            — No Department —
          </button>
        </div>
        ${departments.map(d => `
          <div style="padding:3px 0">
            <button class="btn btn-secondary btn-block" data-pick-dept="${d.id}" data-pick-dept-name="${escapeHtml(d.name)}" style="text-align:left">
              ${escapeHtml(d.name)}
            </button>
          </div>`).join('')}
        ${!departments.length ? '<p class="muted small">No departments yet. Create one first.</p>' : ''}
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('ae_closeDeptPicker').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('[data-pick-dept]').forEach(btn => {
    btn.addEventListener('click', () => {
      addEmpState.departmentId = btn.dataset.pickDept || null;
      addEmpState.departmentName = btn.dataset.pickDeptName || '';
      overlay.remove();
      // Update chip display
      const chip = document.getElementById('ae_deptChip');
      if (chip) {
        chip.innerHTML = addEmpState.departmentName
          ? `<span class="badge-neutral" style="padding:6px 12px;border-radius:20px">${escapeHtml(addEmpState.departmentName)}</span>`
          : `<span class="muted small">No department selected</span>`;
      }
    });
  });
}

// Step 3 – Leave & Dates
function renderAddEmpStep3(content) {
  document.getElementById('addEmpModalTitle').textContent = 'Leave & Dates';
  const currentYear = new Date().getFullYear();

  content.innerHTML = `
    <div class="field">
      <label>Start Date <span style="color:var(--error,#ef4444)">*</span></label>
      <input type="date" id="ae_startDate" value="${addEmpState.startDate}" />
      <span class="muted small">dd/mm/yyyy</span>
    </div>
    <div class="field">
      <label>Annual Leave Allowance (days)</label>
      <input type="number" id="ae_annualLeave" value="${addEmpState.annualLeaveAllowance}" min="0" max="365" />
    </div>
    <div id="ae_proRataBox" class="glass-card" style="padding:12px 16px;border-radius:8px;background:var(--info-bg,rgba(99,102,241,0.1));border:1px solid var(--info,rgba(99,102,241,0.3));${addEmpState.startDate ? '' : 'display:none'}">
      <p class="muted small" id="ae_proRataText">—</p>
    </div>
    <div class="field" style="margin-top:8px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="ae_overrideToggle" ${addEmpState.overrideAllowance ? 'checked' : ''} />
        Override allowance for ${currentYear} only
      </label>
    </div>
    <div class="field" id="ae_overrideWrap" style="${addEmpState.overrideAllowance ? '' : 'display:none'}">
      <label>Override days (can use 0.5 steps)</label>
      <input type="number" id="ae_overrideDays" value="${addEmpState.overrideDays ?? ''}" step="0.5" min="0" max="365" />
    </div>`;

  function updateProRata() {
    const startDateVal = document.getElementById('ae_startDate').value;
    const allowanceVal = parseFloat(document.getElementById('ae_annualLeave').value) || 28;
    const box = document.getElementById('ae_proRataBox');
    const text = document.getElementById('ae_proRataText');
    if (!startDateVal) { box.style.display = 'none'; return; }
    const start = new Date(startDateVal);
    const year = start.getFullYear();
    if (year === currentYear) {
      const yearEnd = new Date(currentYear, 11, 31);
      const msRemaining = yearEnd - start + 86400000; // include start day
      const daysRemaining = msRemaining / 86400000;
      const proRata = Math.round((daysRemaining / 365) * allowanceVal * 10) / 10;
      box.style.display = '';
      text.textContent = `Pro-rata for ${year}: ${proRata} days`;
    } else if (year < currentYear) {
      box.style.display = '';
      text.textContent = `Full allowance applies (started in ${year}).`;
    } else {
      box.style.display = '';
      text.textContent = `Starts in ${year} — full allowance will apply.`;
    }
  }

  document.getElementById('ae_startDate').addEventListener('input', updateProRata);
  document.getElementById('ae_annualLeave').addEventListener('input', updateProRata);
  document.getElementById('ae_overrideToggle').addEventListener('change', function () {
    document.getElementById('ae_overrideWrap').style.display = this.checked ? '' : 'none';
  });

  if (addEmpState.startDate) updateProRata();
}

// Step 4 – Shift Pattern
function renderAddEmpStep4(content) {
  document.getElementById('addEmpModalTitle').textContent = 'Shift Pattern';
  const firstName = (addEmpState.fullName || 'Employee').split(' ')[0];
  const apostrophe = firstName.endsWith('s') ? `${firstName}'` : `${firstName}'s`;

  content.innerHTML = `
    <div class="field">
      <button type="button" class="btn btn-secondary btn-block" id="ae_configShiftBtn">
        Configure ${escapeHtml(apostrophe)} Shift Pattern
      </button>
    </div>
    <div id="ae_shiftPatternDisplay" style="margin-top:8px">
      ${addEmpState.shiftPattern
        ? `<span class="badge-success" style="padding:6px 14px;border-radius:20px">✓ ${escapeHtml(addEmpState.shiftPatternName || addEmpState.shiftPattern.name || 'Pattern selected')}</span>`
        : `<p class="muted small">No shift pattern selected (optional)</p>`}
    </div>`;

  document.getElementById('ae_configShiftBtn').addEventListener('click', openShiftPatternModal);
}

function openShiftPatternModal() {
  if (addEmpShiftBackdrop) addEmpShiftBackdrop.remove();

  addEmpShiftBackdrop = document.createElement('div');
  addEmpShiftBackdrop.style.cssText = 'position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';
  addEmpShiftBackdrop.innerHTML = `
    <div class="modal-card glass-card" style="position:relative;z-index:301;max-width:620px;width:100%;max-height:88vh;overflow-y:auto">
      <div class="modal-header">
        <div><h2>Shift Patterns</h2><p class="muted">Select or create a shift pattern.</p></div>
        <button class="btn btn-secondary icon-btn" id="ae_closeShiftModal">✕</button>
      </div>
      <div id="ae_shiftPatternList" style="margin-bottom:24px"></div>
      <hr style="border:none;border-top:1px solid var(--border,rgba(255,255,255,0.1));margin-bottom:20px"/>
      <h3 style="font-size:1rem;font-weight:600;margin-bottom:14px">Create New Shift Pattern</h3>
      <div class="form-stack" id="ae_newShiftForm">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="field"><label>Pattern Name</label><input type="text" id="ae_shiftName" placeholder="e.g. Standard 9-5" /></div>
          <div class="field"><label>Weekly Hours</label><input type="number" id="ae_shiftWeeklyHours" value="40" step="0.5" min="0" /></div>
        </div>
        <div id="ae_shiftDays" style="display:flex;flex-direction:column;gap:8px">
          ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day => {
            const d = day.toLowerCase();
            return `
              <div style="display:grid;grid-template-columns:160px 1fr 1fr;gap:8px;align-items:center">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                  <input type="checkbox" class="shift-day-cb" data-day="${d}" ${['monday','tuesday','wednesday','thursday','friday'].includes(d) ? 'checked' : ''} />
                  ${day}
                </label>
                <input type="time" class="shift-start" data-day="${d}" value="09:00" ${!['monday','tuesday','wednesday','thursday','friday'].includes(d) ? 'disabled' : ''} />
                <input type="time" class="shift-end" data-day="${d}" value="17:00" ${!['monday','tuesday','wednesday','thursday','friday'].includes(d) ? 'disabled' : ''} />
              </div>`;
          }).join('')}
        </div>
        <p class="form-message" id="ae_shiftMsg"></p>
        <div class="modal-actions">
          <button class="btn btn-primary" id="ae_saveShiftBtn">Save and Select Pattern</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(addEmpShiftBackdrop);

  document.getElementById('ae_closeShiftModal').addEventListener('click', () => {
    addEmpShiftBackdrop?.remove();
    addEmpShiftBackdrop = null;
  });
  addEmpShiftBackdrop.addEventListener('click', e => {
    if (e.target === addEmpShiftBackdrop) {
      addEmpShiftBackdrop?.remove();
      addEmpShiftBackdrop = null;
    }
  });

  // Day checkbox enable/disable
  addEmpShiftBackdrop.querySelectorAll('.shift-day-cb').forEach(cb => {
    cb.addEventListener('change', function () {
      const day = this.dataset.day;
      addEmpShiftBackdrop.querySelector(`.shift-start[data-day="${day}"]`).disabled = !this.checked;
      addEmpShiftBackdrop.querySelector(`.shift-end[data-day="${day}"]`).disabled = !this.checked;
    });
  });

  document.getElementById('ae_saveShiftBtn').addEventListener('click', saveAndSelectShiftPattern);

  loadAndRenderShiftPatterns();
}

async function loadAndRenderShiftPatterns() {
  const list = document.getElementById('ae_shiftPatternList');
  if (!list) return;
  list.innerHTML = `<p class="muted small">Loading...</p>`;
  try {
    shiftPatterns = await getShiftPatterns(ctx.company.id);
    if (!shiftPatterns.length) {
      list.innerHTML = `<p class="muted small">No shift patterns yet. Create one below.</p>`;
      return;
    }
    list.innerHTML = shiftPatterns.map(p => {
      const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
        .filter(d => p[d])
        .map(d => d.charAt(0).toUpperCase() + d.slice(1, 3))
        .join(', ');
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border,rgba(255,255,255,0.08));flex-wrap:wrap;gap:8px">
          <div>
            <span style="font-weight:600">${escapeHtml(p.name)}</span>
            <span class="muted small" style="margin-left:8px">${p.weekly_hours}h/wk</span>
            <span class="muted small" style="margin-left:8px">${days || 'No working days'}</span>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" data-select-shift="${p.id}" data-shift-name="${escapeHtml(p.name)}">Select</button>
            <button class="btn btn-danger icon-btn" data-delete-shift="${p.id}" data-shift-name="${escapeHtml(p.name)}" style="padding:4px 10px!important">Delete</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-select-shift]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pattern = shiftPatterns.find(p => p.id === btn.dataset.selectShift);
        if (pattern) {
          addEmpState.shiftPattern = pattern;
          addEmpState.shiftPatternName = pattern.name;
          updateShiftDisplay();
          addEmpShiftBackdrop?.remove();
          addEmpShiftBackdrop = null;
        }
      });
    });

    list.querySelectorAll('[data-delete-shift]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteShift;
        const name = btn.dataset.shiftName;
        if (!confirm(`Are you sure? This pattern may be used by other employees. Deleting it will unset their pattern.`)) return;
        try {
          await deleteShiftPattern(id, ctx.company.id);
          if (addEmpState.shiftPattern?.id === id) {
            addEmpState.shiftPattern = null;
            addEmpState.shiftPatternName = '';
            updateShiftDisplay();
          }
          await loadAndRenderShiftPatterns();
        } catch (err) {
          showMessage('ae_shiftMsg', err.message, 'error');
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="muted small" style="color:var(--error,#ef4444)">Failed to load patterns: ${escapeHtml(err.message)}</p>`;
  }
}

async function saveAndSelectShiftPattern() {
  const btn = document.getElementById('ae_saveShiftBtn');
  setLoadingButton(btn, true, 'Saving...');
  try {
    const name = document.getElementById('ae_shiftName').value.trim();
    if (!name) { showMessage('ae_shiftMsg', 'Pattern name is required.', 'error'); return; }

    const payload = {
      name,
      weekly_hours: parseFloat(document.getElementById('ae_shiftWeeklyHours').value) || 0
    };

    ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].forEach(day => {
      const cb = addEmpShiftBackdrop.querySelector(`.shift-day-cb[data-day="${day}"]`);
      const start = addEmpShiftBackdrop.querySelector(`.shift-start[data-day="${day}"]`);
      const end = addEmpShiftBackdrop.querySelector(`.shift-end[data-day="${day}"]`);
      payload[day] = cb?.checked || false;
      payload[`${day}_start_time`] = cb?.checked ? (start?.value || null) : null;
      payload[`${day}_end_time`] = cb?.checked ? (end?.value || null) : null;
    });

    const created = await createShiftPattern(ctx.company.id, payload);
    addEmpState.shiftPattern = created;
    addEmpState.shiftPatternName = created.name;
    updateShiftDisplay();
    addEmpShiftBackdrop?.remove();
    addEmpShiftBackdrop = null;
  } catch (err) {
    showMessage('ae_shiftMsg', err.message, 'error');
  } finally {
    setLoadingButton(btn, false);
  }
}

function updateShiftDisplay() {
  const display = document.getElementById('ae_shiftPatternDisplay');
  if (!display) return;
  display.innerHTML = addEmpState.shiftPattern
    ? `<span class="badge-success" style="padding:6px 14px;border-radius:20px">✓ ${escapeHtml(addEmpState.shiftPatternName || addEmpState.shiftPattern.name || 'Pattern selected')}</span>`
    : `<p class="muted small">No shift pattern selected (optional)</p>`;
}

// Step 5 – Review & Invite
function renderAddEmpStep5(content) {
  document.getElementById('addEmpModalTitle').textContent = 'Review & Invite';
  document.getElementById('addEmpNextBtn').style.display = 'none';

  const s = addEmpState;
  const currentYear = new Date().getFullYear();
  let proRataText = '';
  if (s.startDate) {
    const start = new Date(s.startDate);
    if (start.getFullYear() === currentYear) {
      const msRemaining = new Date(currentYear, 11, 31) - start + 86400000;
      const proRata = Math.round((msRemaining / 86400000 / 365) * s.annualLeaveAllowance * 10) / 10;
      proRataText = ` (pro-rata: ${proRata}d for ${currentYear})`;
    }
  }

  content.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
      ${summaryRow('Full Name', s.fullName)}
      ${summaryRow('Work Email', s.workEmail)}
      ${s.personalEmail ? summaryRow('Personal Email', s.personalEmail) : ''}
      ${s.personalPhone ? summaryRow('Phone', s.personalPhone) : ''}
      ${s.employmentType ? summaryRow('Employment Type', s.employmentType === 'Other' ? s.employmentTypeOther || 'Other' : s.employmentType) : ''}
      ${s.noticePeriod ? summaryRow('Notice Period', s.noticePeriod) : ''}
      ${summaryRow('Role', s.role)}
      ${s.departmentName ? summaryRow('Department', s.departmentName) : ''}
      ${s.authorisers.length ? summaryRow('Authorisers', s.authorisers.map(a => a.full_name || a.work_email || a.email).join(', ')) : ''}
      ${s.startDate ? summaryRow('Start Date', formatDate(s.startDate)) : ''}
      ${summaryRow('Annual Leave', `${s.annualLeaveAllowance} days${proRataText}`)}
      ${s.overrideAllowance && s.overrideDays != null ? summaryRow(`Override (${currentYear})`, `${s.overrideDays} days`) : ''}
      ${s.shiftPatternName ? summaryRow('Shift Pattern', s.shiftPatternName) : summaryRow('Shift Pattern', 'None selected')}
    </div>
    <p class="form-message" id="ae_step5Msg"></p>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <button class="btn btn-secondary" style="flex:1" id="ae_sendPersonalBtn">Send to Personal Email</button>
      <button class="btn btn-primary" style="flex:1" id="ae_sendWorkBtn">Send to Work Email</button>
    </div>`;

  document.getElementById('ae_sendPersonalBtn').addEventListener('click', () => submitNewEmployee('personal'));
  document.getElementById('ae_sendWorkBtn').addEventListener('click', () => submitNewEmployee('work'));
}

function summaryRow(label, value) {
  return `
    <div style="display:flex;gap:12px;border-bottom:1px solid var(--border,rgba(255,255,255,0.07));padding-bottom:8px">
      <span class="muted small" style="min-width:140px">${escapeHtml(label)}</span>
      <span style="flex:1">${escapeHtml(String(value || '—'))}</span>
    </div>`;
}

async function submitNewEmployee(emailTarget) {
  const s = addEmpState;
  const personalBtnId = 'ae_sendPersonalBtn';
  const workBtnId = 'ae_sendWorkBtn';
  const btnId = emailTarget === 'personal' ? personalBtnId : workBtnId;
  const btn = document.getElementById(btnId);
  setLoadingButton(btn, true, 'Sending...');
  showMessage('ae_step5Msg', '', 'info');

  try {
    const empType = s.employmentType === 'Other' ? (s.employmentTypeOther || 'Other') : s.employmentType;

    // Generate employee code: first 3 letters of company name (uppercase) + 9 random digits
    const prefix = (ctx.company.name || 'EMP').replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase();
    const digits = String(Math.floor(Math.random() * 1000000000)).padStart(9, '0');
    const employee_code = prefix + digits;

    const payload = {
      employee_code,
      full_name: s.fullName,
      work_email: s.workEmail,
      personal_email: s.personalEmail || null,
      personal_phone: s.personalPhone || null,
      employment_type: empType || null,
      notice_period: s.noticePeriod || null,
      job_title: s.jobTitle || null,
      department_id: s.departmentId || null,
      department: s.departmentName || null,
      role: s.role,
      start_date: s.startDate || null,
      annual_leave_allowance: s.annualLeaveAllowance,
      override_allowance_this_year: s.overrideAllowance ? s.overrideDays : null,
      override_allowance_calculation: s.overrideAllowance || false,
      shift_pattern_id: s.shiftPattern?.id || null,
      invited_by: ctx.session.user.id
    };

    const created = await createEmployeeFull(ctx.company.id, payload);

    // Set authorisers
    if (s.authorisers.length > 0) {
      await setEmployeeAuthorisers(created.id, ctx.company.id, s.authorisers.map(a => a.id));
    }

    // Send invite
    const inviteEmail = emailTarget === 'personal'
      ? (s.personalEmail || s.workEmail)
      : s.workEmail;

    await fetch('/holidaymanagement/send-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: ctx.company.id,
        company_name: ctx.company.name,
        invited_by: ctx.session.user.id,
        invite_type: 'employee',
        employee_id: created.id,
        full_name: s.fullName,
        email: inviteEmail,
        role: s.role,
        department: s.departmentName || null,
        job_title: s.jobTitle || null,
        annual_leave_allowance: s.annualLeaveAllowance
      })
    });

    closeModal('addEmpModal');
    await loadEmployees();
  } catch (err) {
    showMessage('ae_step5Msg', err.message, 'error');
  } finally {
    setLoadingButton(btn, false);
  }
}

function collectStep1() {
  addEmpState.fullName = document.getElementById('ae_fullName')?.value.trim() || '';
  addEmpState.jobTitle = document.getElementById('ae_jobTitle')?.value.trim() || '';
  addEmpState.workEmail = document.getElementById('ae_workEmail')?.value.trim() || '';
  addEmpState.personalEmail = document.getElementById('ae_personalEmail')?.value.trim() || '';
  addEmpState.personalPhone = document.getElementById('ae_personalPhone')?.value.trim() || '';
  const empTypeOther = document.getElementById('ae_empTypeOther');
  if (empTypeOther) addEmpState.employmentTypeOther = empTypeOther.value.trim();
  addEmpState.noticePeriod = document.getElementById('ae_noticePeriod')?.value.trim() || '';
}

function collectStep3() {
  addEmpState.startDate = document.getElementById('ae_startDate')?.value || '';
  addEmpState.annualLeaveAllowance = parseInt(document.getElementById('ae_annualLeave')?.value) || 28;
  addEmpState.overrideAllowance = document.getElementById('ae_overrideToggle')?.checked || false;
  const overrideDaysEl = document.getElementById('ae_overrideDays');
  addEmpState.overrideDays = addEmpState.overrideAllowance && overrideDaysEl
    ? (parseFloat(overrideDaysEl.value) || null)
    : null;
}

function validateStep1() {
  if (!addEmpState.fullName) return 'Full Name is required.';
  if (!addEmpState.jobTitle) return 'Job Title is required.';
  if (!addEmpState.workEmail) return 'Work Email is required.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addEmpState.workEmail)) return 'Please enter a valid work email.';
  return null;
}

function validateStep3() {
  if (!addEmpState.startDate) return 'Start Date is required.';
  return null;
}

function addEmpNext() {
  showMessage('addEmpMsg', '', 'info');

  if (addEmpStep === 1) {
    collectStep1();
    const err = validateStep1();
    if (err) { showMessage('addEmpMsg', err, 'error'); return; }
  } else if (addEmpStep === 3) {
    collectStep3();
    const err = validateStep3();
    if (err) { showMessage('addEmpMsg', err, 'error'); return; }
  }

  addEmpStep++;
  renderAddEmpStep();
}

function addEmpBack() {
  showMessage('addEmpMsg', '', 'info');

  // Persist current step data before going back
  if (addEmpStep === 1) collectStep1();
  if (addEmpStep === 3) collectStep3();

  addEmpStep--;
  renderAddEmpStep();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function openModal(id) { document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id)?.classList.add('hidden'); }

init();
