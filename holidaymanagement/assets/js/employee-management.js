import { requireAdminPageAccess } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, showMessage } from '../../shared/ui.js';
import {
  getEmployeesByCompany,
  upsertEmployee,
  archiveEmployee,
  restoreEmployee,
  getMyCompanyInfo,
  sendEmployeeInvite,
  getShiftPatterns,
  createShiftPattern
} from '../../shared/api.js';

let profile = null;
let companyInfo = null;
let employees = [];
let shiftPatterns = [];
let savedEmployee = null;

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function getStatusFilter() {
  return document.getElementById('statusFilter')?.dataset.value || 'active';
}

function generateDigits(length = 9) {
  let value = '';
  for (let i = 0; i < length; i += 1) {
    value += Math.floor(Math.random() * 10);
  }
  return value;
}

function getCompanyPrefix() {
  const name = companyInfo?.company_name || 'Smartfits';
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  return `${letters}XXX`.slice(0, 3);
}

function generateEmployeeCode() {
  return `${getCompanyPrefix()}${generateDigits(9)}`;
}

function generateToken() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function expiresIn12Hours() {
  const date = new Date();
  date.setHours(date.getHours() + 12);
  return date.toISOString();
}

function setupCustomSelects() {
  document.querySelectorAll('.custom-select').forEach((selectEl) => {
    const trigger = selectEl.querySelector('.custom-select-trigger');
    const menu = selectEl.querySelector('.custom-select-menu');

    trigger?.addEventListener('click', (event) => {
      event.stopPropagation();
      selectEl.classList.toggle('open');
    });

    menu?.querySelectorAll('button[data-value]').forEach((option) => {
      option.addEventListener('click', () => {
        selectEl.dataset.value = option.dataset.value;
        selectEl.querySelector('.custom-select-trigger span').textContent = option.textContent.trim();
        selectEl.classList.remove('open');
        renderEmployees();
      });
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select.open').forEach((selectEl) => {
      selectEl.classList.remove('open');
    });
  });
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function getField(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function populateShiftPatterns(selectedId = '') {
  const select = document.getElementById('shiftPatternId');
  if (!select) return;

  select.innerHTML = `<option value="">Select a shift pattern...</option>`;

  shiftPatterns.forEach((pattern) => {
    const option = document.createElement('option');
    option.value = pattern.id;
    option.textContent = `${pattern.name} (${pattern.annual_allowance_days || 23} days)`;
    select.appendChild(option);
  });

  select.value = selectedId || '';
}

function getEmployeePayload() {
  const existingEmployee = savedEmployee || employees.find((employee) => employee.id === getField('employeeId'));

  return {
    id: getField('employeeId') || null,
    company_id: profile.company_id,

    employee_code: existingEmployee?.employee_code || generateEmployeeCode(),

    full_name: getField('fullName'),
    job_title: getField('jobTitle'),
    work_email: getField('workEmail').toLowerCase(),
    personal_email: getField('personalEmail').toLowerCase(),
    personal_phone: getField('personalPhone'),
    employment_type: getField('employmentType'),
    notice_period: getField('noticePeriod'),

    role: getField('role') || 'employee',
    is_admin: getField('isAdmin') === 'true',
    annual_leave_allowance: getField('annualLeaveAllowance') || 23,

    shift_pattern_id: getField('shiftPatternId'),

    employment_status: existingEmployee?.employment_status || 'active',

    bank_holiday_region: 'england',
    include_bank_holidays: true,

    onboarding_status: 'in_progress',
    onboarding_token: existingEmployee?.onboarding_token || generateToken(),
    onboarding_expires_at: existingEmployee?.onboarding_expires_at || expiresIn12Hours()
  };
}

function fillEmployeeForm(employee = null) {
  savedEmployee = employee;

  document.getElementById('employeeModalTitle').textContent =
    employee ? 'Edit Employee' : 'Add Employee';

  setField('employeeId', employee?.id);
  setField('fullName', employee?.full_name);
  setField('jobTitle', employee?.job_title);
  setField('workEmail', employee?.work_email);
  setField('personalEmail', employee?.personal_email);
  setField('personalPhone', employee?.personal_phone);
  setField('employmentType', employee?.employment_type);
  setField('noticePeriod', employee?.notice_period);
  setField('role', employee?.role || 'employee');
  setField('isAdmin', String(employee?.is_admin || false));
  setField('annualLeaveAllowance', employee?.annual_leave_allowance || 23);

  populateShiftPatterns(employee?.shift_pattern_id || '');
}

function renderEmployees() {
  const list = document.getElementById('employeesList');
  const search = document.getElementById('employeeSearch')?.value?.toLowerCase() || '';
  const status = getStatusFilter();

  let filtered = [...employees];

  if (status !== 'all') {
    filtered = filtered.filter((employee) => employee.employment_status === status);
  }

  if (search) {
    filtered = filtered.filter((employee) =>
      JSON.stringify(employee).toLowerCase().includes(search)
    );
  }

  document.getElementById('employeeCount').textContent =
    `${filtered.length} employee${filtered.length === 1 ? '' : 's'} shown`;

  if (!filtered.length) {
    renderEmptyState(list, 'No employees found.');
    return;
  }

  list.innerHTML = filtered.map((employee) => {
    const shift = shiftPatterns.find((pattern) => pattern.id === employee.shift_pattern_id);

    return `
      <article class="leave-card">
        <div class="leave-card-top">
          <div>
            <p class="leave-card-title">${employee.full_name || 'Employee'}</p>
            <p class="leave-card-subtitle">
              ${employee.employee_code || '—'} • ${employee.job_title || '—'} • ${employee.work_email || 'No work email'}
            </p>
            <p class="leave-card-subtitle">
              ${employee.employment_status} • ${employee.role} • Shift: ${shift?.name || 'Not configured'} • Onboarding: ${employee.onboarding_status}
            </p>
          </div>

          <div class="inline-actions">
            <button class="btn btn-secondary" data-action="edit" data-id="${employee.id}" type="button">Edit</button>
            <button class="btn btn-primary" data-action="invite" data-id="${employee.id}" type="button">Send Invite</button>
            ${
              employee.employment_status === 'archived'
                ? `<button class="btn btn-primary" data-action="restore" data-id="${employee.id}" type="button">Restore</button>`
                : `<button class="btn btn-danger" data-action="archive" data-id="${employee.id}" type="button">Archive</button>`
            }
          </div>
        </div>
      </article>
    `;
  }).join('');
}

async function loadEmployees() {
  employees = await getEmployeesByCompany(profile.company_id);
  renderEmployees();
}

async function loadShiftPatterns() {
  shiftPatterns = await getShiftPatterns(profile.company_id);
  populateShiftPatterns(savedEmployee?.shift_pattern_id || '');
}

async function sendInvite(toType) {
  if (!savedEmployee) return;

  if (!savedEmployee.shift_pattern_id) {
    showMessage('inviteMessage', 'You must configure/select a shift pattern before sending the onboarding email.', 'error');
    return;
  }

  const toEmail =
    toType === 'personal'
      ? savedEmployee.personal_email
      : savedEmployee.work_email;

  if (!toEmail) {
    showMessage('inviteMessage', 'That email address is missing.', 'error');
    return;
  }

  const onboardingUrl =
    `${window.location.origin}/holidaymanagement/onboarding.html?token=${encodeURIComponent(savedEmployee.onboarding_token)}`;

  try {
    showMessage('inviteMessage', 'Sending invitation...', 'info');

    await sendEmployeeInvite({
      to: toEmail,
      employee_name: savedEmployee.full_name,
      onboarding_url: onboardingUrl,
      expires_at: savedEmployee.onboarding_expires_at
    });

    showMessage('inviteMessage', `Invitation sent to ${toEmail}.`, 'success');
  } catch (error) {
    showMessage('inviteMessage', error.message || 'Invitation failed.', 'error');
  }
}

async function init() {
  const auth = await requireAdminPageAccess();
  if (!auth) return;

  profile = auth.profile;
  companyInfo = await getMyCompanyInfo();

  setupCustomSelects();

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut();
    window.location.href = './login.html';
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  document.getElementById('addEmployeeBtn')?.addEventListener('click', () => {
    fillEmployeeForm(null);
    openModal('employeeModal');
  });

  document.getElementById('configureShiftPatternsBtn')?.addEventListener('click', () => {
    openModal('shiftPatternModal');
  });

  document.getElementById('employeeSearch')?.addEventListener('input', renderEmployees);

  document.getElementById('employeesList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const employee = employees.find((item) => item.id === button.dataset.id);
    if (!employee) return;

    if (button.dataset.action === 'edit') {
      fillEmployeeForm(employee);
      openModal('employeeModal');
    }

    if (button.dataset.action === 'invite') {
      savedEmployee = employee;

      if (!employee.shift_pattern_id) {
        document.getElementById('inviteSummary').textContent =
          `${employee.full_name} needs a shift pattern before an invite can be sent.`;
      } else {
        document.getElementById('inviteSummary').textContent =
          `${employee.full_name} • ${employee.personal_email || 'No personal email'} • ${employee.work_email || 'No work email'}`;
      }

      openModal('inviteModal');
    }

    if (button.dataset.action === 'archive') {
      await archiveEmployee(employee);
      await loadEmployees();
    }

    if (button.dataset.action === 'restore') {
      await restoreEmployee(employee);
      await loadEmployees();
    }
  });

  document.getElementById('employeeForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const payload = getEmployeePayload();

      if (!payload.full_name || !payload.work_email || !payload.personal_email) {
        showMessage('employeeMessage', 'Full name, work email and personal email are required.', 'error');
        return;
      }

      if (!payload.shift_pattern_id) {
        showMessage('employeeMessage', 'Please configure/select a shift pattern before continuing.', 'error');
        return;
      }

      const employeeId = await upsertEmployee(payload);

      await loadEmployees();

      savedEmployee =
        employees.find((employee) => employee.id === employeeId) ||
        employees.find((employee) => employee.employee_code === payload.employee_code);

      closeModal('employeeModal');

      document.getElementById('inviteSummary').textContent =
        `${savedEmployee.full_name} • ${savedEmployee.personal_email} • ${savedEmployee.work_email}`;

      openModal('inviteModal');
    } catch (error) {
      showMessage('employeeMessage', error.message || 'Unable to save employee.', 'error');
    }
  });

  document.getElementById('shiftPatternForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const pattern = await createShiftPattern({
        company_id: profile.company_id,
        name: getField('shiftName'),
        monday: document.getElementById('shiftMonday').checked,
        tuesday: document.getElementById('shiftTuesday').checked,
        wednesday: document.getElementById('shiftWednesday').checked,
        thursday: document.getElementById('shiftThursday').checked,
        friday: document.getElementById('shiftFriday').checked,
        saturday: document.getElementById('shiftSaturday').checked,
        sunday: document.getElementById('shiftSunday').checked,
        start_time: getField('shiftStartTime'),
        end_time: getField('shiftEndTime'),
        weekly_hours: Number(getField('shiftWeeklyHours') || 0),
        annual_allowance_days: Number(getField('shiftAnnualAllowance') || 23)
      });

      await loadShiftPatterns();

      setField('shiftPatternId', pattern.id);
      setField('annualLeaveAllowance', pattern.annual_allowance_days || 23);

      closeModal('shiftPatternModal');
    } catch (error) {
      showMessage('shiftPatternMessage', error.message || 'Unable to save shift pattern.', 'error');
    }
  });

  document.getElementById('sendPersonalInviteBtn')?.addEventListener('click', () => sendInvite('personal'));
  document.getElementById('sendWorkInviteBtn')?.addEventListener('click', () => sendInvite('work'));

  await loadShiftPatterns();
  await loadEmployees();
  revealApp();
}

init().catch((error) => {
  console.error(error);

  const loader = document.getElementById('appLoader');
  if (loader) {
    loader.innerHTML = `
      <div style="padding:24px;text-align:center;">
        <h2>Employee Management failed to load</h2>
        <p>${error.message || 'Unknown error'}</p>
      </div>
    `;
  }
});
