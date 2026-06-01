import { requireAdminPageAccess } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { showMessage, renderEmptyState, openModal, closeModal, escapeHtml } from '../../shared/ui.js';
import { formatDate, prorateAllowance } from '../../shared/dates.js';
import * as api from '../../shared/api.js';

const fieldMap = {
  niNumber: 'ni_number',
  addressLine1: 'address_line1', addressLine2: 'address_line2', addressCity: 'address_city', addressCounty: 'address_county', addressPostcode: 'address_postcode', addressCountry: 'address_country',
  emergencyContactName1: 'emergency_contact_name1', emergencyContactRelationship1: 'emergency_contact_relationship1', emergencyContactEmail1: 'emergency_contact_email1', emergencyContactPhone1: 'emergency_contact_phone1',
  emergencyContactName2: 'emergency_contact_name2', emergencyContactRelationship2: 'emergency_contact_relationship2', emergencyContactEmail2: 'emergency_contact_email2', emergencyContactPhone2: 'emergency_contact_phone2'
};
const editOnlyIds = ['title','pronouns','dob','niNumber','addressLine1','addressLine2','addressCity','addressCounty','addressPostcode','addressCountry','emergencyContactName1','emergencyContactRelationship1','emergencyContactEmail1','emergencyContactPhone1','emergencyContactName2','emergencyContactRelationship2','emergencyContactEmail2','emergencyContactPhone2'];

const ctx = await requireAdminPageAccess();
if (ctx) {
  const { profile } = ctx;
  let employees = [];
  let departments = [];
  let editing = null;
  let selectedAuthoriser = null;

  const employeeForm = document.getElementById('employeeForm');
  const employeeSearch = document.getElementById('employeeSearch');
  const statusFilter = document.getElementById('statusFilter');
  const employeesList = document.getElementById('employeesList');
  const employeeCount = document.getElementById('employeeCount');
  const roleEl = document.getElementById('role');
  const isAdminEl = document.getElementById('isAdmin');
  const allowanceEl = document.getElementById('annualLeaveAllowance');
  const startDateEl = document.getElementById('startDate');
  const allowanceHint = document.getElementById('allowanceHint');
  const authoriserSearch = document.getElementById('authoriserSearch');
  const authoriserResults = document.getElementById('authoriserResults');
  const selectedAuthoriserBox = document.getElementById('selectedAuthoriserBox');
  const departmentInput = document.getElementById('department');
  const departmentResults = document.getElementById('departmentResults');
  const allowanceOverrideEnabled = document.getElementById('allowanceOverrideEnabled');
  const allowanceOverrideRow = document.getElementById('allowanceOverrideRow');

  document.getElementById('logoutBtn')?.addEventListener('click', async () => { await signOut(); location.href = './login.html'; });
  document.querySelectorAll('[data-close-modal]').forEach(b => b.addEventListener('click', () => closeModal(b.dataset.closeModal)));

  function getVal(id) { return document.getElementById(id)?.value?.trim() || ''; }
  function setVal(id, value) { const el = document.getElementById(id); if (el) el.value = value ?? ''; }
  function roleRequiresOwner() { return roleEl.value === 'admin' || isAdminEl.value === 'true'; }
  function authoriserPool() { return employees.filter(e => ['owner','admin'].includes(String(e.role || '').toLowerCase()) || e.is_admin === true); }

  function updateAllowanceHint() {
    const allowance = Number(allowanceEl.value || 0);
    const startDate = startDateEl.value;
    const calculated = prorateAllowance(allowance, startDate);
    if (!startDate) allowanceHint.textContent = 'Enter a start date to calculate this holiday year.';
    else allowanceHint.textContent = `This employee will have ${calculated} day${calculated === 1 ? '' : 's'} for this holiday year.`;
  }

  function setAuthoriser(emp) {
    selectedAuthoriser = emp || null;
    setVal('assignedAuthoriser', emp?.id || '');
    if (!emp) {
      selectedAuthoriserBox.classList.add('hidden');
      selectedAuthoriserBox.innerHTML = '';
      authoriserSearch.value = '';
      return;
    }
    selectedAuthoriserBox.classList.remove('hidden');
    selectedAuthoriserBox.innerHTML = `<strong>${escapeHtml(emp.full_name || 'Employee')}</strong><span>${escapeHtml(emp.role || 'employee')} • ${escapeHtml(emp.job_title || '—')}</span>`;
    authoriserSearch.value = emp.full_name || '';
  }

  function renderAuthoriserResults() {
    const term = authoriserSearch.value.toLowerCase().trim();
    const pool = authoriserPool().filter(e => e.id !== getVal('employeeId'));
    const filtered = pool.filter(e => !term || [e.full_name, e.job_title, e.department, e.role].filter(Boolean).join(' ').toLowerCase().includes(term)).slice(0, 12);
    if (!filtered.length) {
      authoriserResults.classList.remove('hidden');
      authoriserResults.innerHTML = '<div class="search-result-empty">No owner or admin found.</div>';
      return;
    }
    const adminTarget = roleRequiresOwner();
    authoriserResults.classList.remove('hidden');
    authoriserResults.innerHTML = filtered.map(e => {
      const isOwner = String(e.role || '').toLowerCase() === 'owner';
      const disabled = adminTarget && !isOwner;
      return `<button type="button" class="authoriser-result" data-authoriser="${e.id}" ${disabled ? 'disabled' : ''}>
        <strong>${escapeHtml(e.full_name || 'Employee')}</strong><br>
        <span class="muted small">${escapeHtml(e.role || 'employee')} • ${escapeHtml(e.job_title || '—')} ${e.department ? '• ' + escapeHtml(e.department) : ''}</span>
        ${disabled ? '<span class="disabled-reason">Sorry, admins can not be selected for another admin.</span>' : ''}
      </button>`;
    }).join('');
  }

  function renderDepartmentResults() {
    const typed = departmentInput.value.trim();
    const lower = typed.toLowerCase();
    const matches = departments.filter(d => d.toLowerCase().includes(lower)).slice(0, 10);
    const showCreate = typed && !departments.some(d => d.toLowerCase() === lower);
    if (!matches.length && !showCreate) {
      departmentResults.classList.add('hidden');
      departmentResults.innerHTML = '';
      return;
    }
    departmentResults.classList.remove('hidden');
    departmentResults.innerHTML = [
      ...matches.map(d => `<button class="department-result" type="button" data-department="${escapeHtml(d)}">${escapeHtml(d)}</button>`),
      showCreate ? `<button class="department-result" type="button" data-department="${escapeHtml(typed)}">Add new department: <strong>${escapeHtml(typed)}</strong></button>` : ''
    ].join('');
  }

  function setModalMode(isEdit) {
    document.getElementById('employeeModalTitle').textContent = isEdit ? 'Edit Employee' : 'Add Employee';
    document.getElementById('employeeModalSubtitle').textContent = isEdit ? 'Edit work, personal and onboarding details.' : 'Add the work details first. Personal details are completed during onboarding.';
    document.querySelectorAll('[data-edit-only]').forEach(el => el.classList.toggle('hidden', !isEdit));
  }

  function fillForm(employee = null) {
    editing = employee;
    employeeForm.reset();
    setModalMode(!!employee);
    setVal('employeeId', employee?.id || '');
    setVal('fullName', employee?.full_name || '');
    setVal('department', employee?.department || '');
    setVal('jobTitle', employee?.job_title || '');
    setVal('workEmail', employee?.work_email || '');
    setVal('personalEmail', employee?.personal_email || '');
    setVal('personalPhone', employee?.personal_phone || '');
    setVal('employmentType', employee?.employment_type || 'Full Time');
    setVal('noticePeriod', employee?.notice_period || '');
    setVal('role', employee?.role || 'employee');
    setVal('isAdmin', String(employee?.is_admin || false));
    setVal('employmentStatus', employee?.employment_status || 'active');
    setVal('annualLeaveAllowance', employee?.annual_leave_allowance ?? 28);
    setVal('startDate', employee?.start_date || '');
    setVal('includeBankHolidays', String(employee?.include_bank_holidays ?? true));
    allowanceOverrideEnabled.checked = employee?.override_allowance_calculation === true;
    setVal('currentYearAllowanceOverride', employee?.override_allowance_this_year ?? '');
    allowanceOverrideRow.classList.toggle('hidden', !allowanceOverrideEnabled.checked);

    editOnlyIds.forEach(id => setVal(id, employee?.[fieldMap[id] || id] || ''));
    setAuthoriser(employees.find(e => e.id === employee?.assigned_authoriser) || null);
    updateAllowanceHint();
    openModal('employeeModal');
  }

  function payloadFromForm() {
    return {
      id: getVal('employeeId') || null,
      company_id: profile.company_id,
      full_name: getVal('fullName'),
      department: getVal('department'),
      job_title: getVal('jobTitle'),
      work_email: getVal('workEmail').toLowerCase(),
      personal_email: getVal('personalEmail').toLowerCase(),
      personal_phone: getVal('personalPhone'),
      employment_type: getVal('employmentType'),
      notice_period: getVal('noticePeriod'),
      role: getVal('role'),
      is_admin: getVal('isAdmin') === 'true' || getVal('role') === 'admin' || getVal('role') === 'owner',
      employment_status: getVal('employmentStatus'),
      annual_leave_allowance: Number(getVal('annualLeaveAllowance') || 28),
      start_date: getVal('startDate'),
      include_bank_holidays: getVal('includeBankHolidays') === 'true',
      override_allowance_calculation: allowanceOverrideEnabled.checked,
      override_allowance_this_year: allowanceOverrideEnabled.checked ? Number(getVal('currentYearAllowanceOverride') || 0) : null,
      shift_pattern_id: getVal('shiftPatternId') || null,
      assigned_authoriser: getVal('assignedAuthoriser') || null,
      onboarding_status: editing?.onboarding_status || 'not_started',
      title: getVal('title'), pronouns: getVal('pronouns'), dob: getVal('dob'), ni_number: getVal('niNumber'),
      address_line1: getVal('addressLine1'), address_line2: getVal('addressLine2'), address_city: getVal('addressCity'), address_county: getVal('addressCounty'), address_postcode: getVal('addressPostcode'), address_country: getVal('addressCountry'),
      emergency_contact_name1: getVal('emergencyContactName1'), emergency_contact_relationship1: getVal('emergencyContactRelationship1'), emergency_contact_email1: getVal('emergencyContactEmail1'), emergency_contact_phone1: getVal('emergencyContactPhone1'),
      emergency_contact_name2: getVal('emergencyContactName2'), emergency_contact_relationship2: getVal('emergencyContactRelationship2'), emergency_contact_email2: getVal('emergencyContactEmail2'), emergency_contact_phone2: getVal('emergencyContactPhone2')
    };
  }

  function renderEmployees() {
    const term = employeeSearch.value.toLowerCase();
    const status = statusFilter.value;
    const rows = employees.filter(e => (status === 'all' || e.employment_status === status) && JSON.stringify(e).toLowerCase().includes(term));
    employeeCount.textContent = `${rows.length} employee${rows.length === 1 ? '' : 's'} shown`;
    if (!rows.length) return renderEmptyState(employeesList, 'No employees found.');
    employeesList.innerHTML = rows.map(e => `
      <article class="leave-card">
        <div class="leave-card-top">
          <div>
            <p class="leave-card-title">${escapeHtml(e.full_name || 'Employee')}</p>
            <p class="leave-card-subtitle">${escapeHtml(e.employee_code || '—')} • ${escapeHtml(e.job_title || '—')} • ${escapeHtml(e.department || 'No department')} • ${escapeHtml(e.work_email || 'No email')}</p>
            <p class="leave-card-subtitle">${escapeHtml(e.employment_status || 'active')} • ${escapeHtml(e.role || 'employee')} • First login: ${e.first_login_at ? formatDate(e.first_login_at) : 'Not logged in yet'}</p>
          </div>
          <div class="inline-actions">
            <button class="btn btn-secondary" data-view="${e.id}" type="button">View</button>
            <button class="btn btn-secondary" data-edit="${e.id}" type="button">Edit</button>
            <button class="btn btn-primary" data-invite="${e.id}" type="button">Send Invite</button>
          </div>
        </div>
      </article>`).join('');
  }

  async function load() {
    employees = await api.getEmployees(profile.company_id);
    departments = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();
    renderEmployees();
  }

  employeeSearch.addEventListener('input', renderEmployees);
  statusFilter.addEventListener('change', renderEmployees);
  document.getElementById('addEmployeeBtn')?.addEventListener('click', () => fillForm());
  allowanceEl.addEventListener('input', updateAllowanceHint);
  startDateEl.addEventListener('change', updateAllowanceHint);
  allowanceOverrideEnabled.addEventListener('change', () => allowanceOverrideRow.classList.toggle('hidden', !allowanceOverrideEnabled.checked));
  roleEl.addEventListener('change', () => { if (selectedAuthoriser) renderAuthoriserResults(); });
  isAdminEl.addEventListener('change', () => { if (selectedAuthoriser) renderAuthoriserResults(); });
  authoriserSearch.addEventListener('input', renderAuthoriserResults);
  authoriserSearch.addEventListener('focus', renderAuthoriserResults);
  authoriserResults.addEventListener('click', event => {
    const btn = event.target.closest('[data-authoriser]');
    if (!btn || btn.disabled) return;
    setAuthoriser(employees.find(e => e.id === btn.dataset.authoriser));
    authoriserResults.classList.add('hidden');
  });
  departmentInput.addEventListener('input', renderDepartmentResults);
  departmentInput.addEventListener('focus', renderDepartmentResults);
  departmentResults.addEventListener('click', event => {
    const btn = event.target.closest('[data-department]');
    if (!btn) return;
    departmentInput.value = btn.dataset.department;
    departmentResults.classList.add('hidden');
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#authoriserField')) authoriserResults.classList.add('hidden');
    if (!event.target.closest('#department') && !event.target.closest('#departmentResults')) departmentResults.classList.add('hidden');
  });

  employeeForm.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const payload = payloadFromForm();
      if (roleRequiresOwner() && selectedAuthoriser && String(selectedAuthoriser.role).toLowerCase() !== 'owner') {
        throw new Error('Admins must have an owner as their authorising user.');
      }
      await api.upsertEmployee(payload);
      showMessage('employeeMessage', 'Employee saved.', 'success');
      closeModal('employeeModal');
      await load();
    } catch (error) {
      showMessage('employeeMessage', error.message || 'Could not save employee.', 'error');
    }
  });

  employeesList.addEventListener('click', async event => {
    const edit = event.target.closest('[data-edit]');
    const view = event.target.closest('[data-view]');
    const invite = event.target.closest('[data-invite]');
    if (edit) fillForm(employees.find(e => e.id === edit.dataset.edit));
    if (view) {
      const emp = employees.find(e => e.id === view.dataset.view);
      viewEmployeeContent.innerHTML = Object.entries(emp).map(([k,v]) => `<div class="detail-tile"><span class="detail-label">${escapeHtml(k.replaceAll('_',' '))}</span><div class="detail-value">${escapeHtml(v ?? '—')}</div></div>`).join('');
      openModal('employeeViewModal');
    }
    if (invite) {
      const emp = employees.find(e => e.id === invite.dataset.invite);
      await api.sendEmployeeInvite(emp.id, emp.personal_email || emp.work_email);
      alert('Invite created. Email sending will use the configured function once enabled.');
    }
  });

  await load();
}
