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
  for (let i = 0; i < length; i += 1) value += Math.floor(Math.random() * 10);
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

function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function getField(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function setShiftPattern(patternId) {
  const pattern = shiftPatterns.find((item) => item.id === patternId);
  setField('shiftPatternId', patternId || '');

  const box = document.getElementById('selectedShiftBox');

  if (!box) return;

  if (!pattern) {
    box.innerHTML = `
      <strong>No shift pattern selected</strong>
      <span>Press the button below to select or configure one.</span>
    `;
    return;
  }

  box.innerHTML = `
    <strong>${pattern.name}</strong>
    <span>${pattern.weekly_hours || '—'} hours/week • ${pattern.annual_allowance_days || 23} AL days</span>
  `;

  setField('annualLeaveAllowance', pattern.annual_allowance_days || 23);
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

function getEmployeePayload() {
  const existingEmployee = savedEmployee || employees.find((employee) => employee.id === getField('employeeId'));

  return {
    id: getField('employeeId') || null,
    company_id: profile.company_id,

    employee_code: getField('employeeCode') || existingEmployee?.employee_code || generateEmployeeCode(),

    full_name: getField('fullName'),
    job_title: getField('jobTitle'),
    work_email: getField('workEmail').toLowerCase(),
    personal_email: getField('personalEmail').toLowerCase(),
    personal_phone: getField('personalPhone'),
    employment_type: getField('employmentType'),
    notice_period: getField('noticePeriod'),
    start_date: getField('startDate'),

    role: getField('role') || 'employee',
    is_admin: getField('isAdmin') === 'true',
    employment_status: getField('employmentStatus') || 'active',

    annual_leave_allowance: getField('annualLeaveAllowance') || 23,
    bank_holiday_region: getField('bankHolidayRegion') || 'england',
    include_bank_holidays: getField('includeBankHolidays') === 'true',
    shift_pattern_id: getField('shiftPatternId'),

    title: getField('title'),
    pronouns: getField('pronouns'),
    gender: getField('gender'),
    dob: getField('dob'),
    nationality: getField('nationality'),
    ni_number: getField('niNumber'),
    passport_number: getField('passportNumber'),
    passport_expiry_date: getField('passportExpiryDate'),
    driving_licence_number: getField('drivingLicenceNumber'),

    address_line1: getField('addressLine1'),
    address_line2: getField('addressLine2'),
    address_city: getField('addressCity'),
    address_county: getField('addressCounty'),
    address_postcode: getField('addressPostcode'),
    address_country: getField('addressCountry'),

    emergency_contact_name1: getField('emergencyContactName1'),
    emergency_contact_relationship1: getField('emergencyContactRelationship1'),
    emergency_contact_email1: getField('emergencyContactEmail1'),
    emergency_contact_phone1: getField('emergencyContactPhone1'),

    emergency_contact_name2: getField('emergencyContactName2'),
    emergency_contact_relationship2: getField('emergencyContactRelationship2'),
    emergency_contact_email2: getField('emergencyContactEmail2'),
    emergency_contact_phone2: getField('emergencyContactPhone2'),

    onboarding_status: getField('onboardingStatus') || existingEmployee?.onboarding_status || 'in_progress',
    onboarding_token: existingEmployee?.onboarding_token || generateToken(),
    onboarding_expires_at: existingEmployee?.onboarding_expires_at || expiresIn12Hours()
  };
}

function fillEmployeeForm(employee = null) {
  savedEmployee = employee;

  document.getElementById('employeeModalTitle').textContent =
    employee ? 'Edit Employee' : 'Add Employee';

  const newCode = employee?.employee_code || generateEmployeeCode();

  setField('employeeId', employee?.id);
  setField('employeeCode', newCode);
  setField('fullName', employee?.full_name);
  setField('jobTitle', employee?.job_title);
  setField('workEmail', employee?.work_email);
  setField('personalEmail', employee?.personal_email);
  setField('personalPhone', employee?.personal_phone);
  setField('employmentType', employee?.employment_type);
  setField('noticePeriod', employee?.notice_period);
  setField('startDate', employee?.start_date);

  setField('role', employee?.role || 'employee');
  setField('isAdmin', String(employee?.is_admin || false));
  setField('employmentStatus', employee?.employment_status || 'active');

  setField('annualLeaveAllowance', employee?.annual_leave_allowance || 23);
  setField('bankHolidayRegion', employee?.bank_holiday_region || 'england');
  setField('includeBankHolidays', String(employee?.include_bank_holidays ?? true));

  setField('title', employee?.title);
  setField('pronouns', employee?.pronouns);
  setField('gender', employee?.gender);
  setField('dob', employee?.dob);
  setField('nationality', employee?.nationality);
  setField('niNumber', employee?.ni_number);
  setField('passportNumber', employee?.passport_number);
  setField('passportExpiryDate', employee?.passport_expiry_date);
  setField('drivingLicenceNumber', employee?.driving_licence_number);

  setField('addressLine1', employee?.address_line1);
  setField('addressLine2', employee?.address_line2);
  setField('addressCity', employee?.address_city);
  setField('addressCounty', employee?.address_county);
  setField('addressPostcode', employee?.address_postcode);
  setField('addressCountry', employee?.address_country || 'United Kingdom');

  setField('emergencyContactName1', employee?.emergency_contact_name1);
  setField('emergencyContactRelationship1', employee?.emergency_contact_relationship1);
  setField('emergencyContactEmail1', employee?.emergency_contact_email1);
  setField('emergencyContactPhone1', employee?.emergency_contact_phone1);

  setField('emergencyContactName2', employee?.emergency_contact_name2);
  setField('emergencyContactRelationship2', employee?.emergency_contact_relationship2);
  setField('emergencyContactEmail2', employee?.emergency_contact_email2);
  setField('emergencyContactPhone2', employee?.emergency_contact_phone2);

  setField('onboardingStatus', employee?.onboarding_status || 'in_progress');
  setField('onboardingExpiresAt', employee?.onboarding_expires_at ? employee.onboarding_expires_at.slice(0, 16) : '');

  setShiftPattern(employee?.shift_pattern_id || '');
}

function renderShiftPatterns() {
  const list = document.getElementById('shiftPatternList');
  if (!list) return;

  if (!shiftPatterns.length) {
    renderEmptyState(list, 'No shift patterns yet. Create one below.');
    return;
  }

  list.innerHTML = shiftPatterns.map((pattern) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${pattern.name}</p>
          <p class="leave-card-subtitle">
            ${pattern.weekly_hours || '—'} hours/week • ${pattern.annual_allowance_days || 23} AL days
          </p>
        </div>
        <button class="btn btn-primary" data-select-shift="${pattern.id}" type="button">Select</button>
      </div>
    </article>
  `).join('');
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
  renderShiftPatterns();
}

async function sendInvite(toType) {
  if (!savedEmployee) return;

  if (!savedEmployee.shift_pattern_id) {
    showMessage('inviteMessage', 'You must select a shift pattern before sending the onboarding email.', 'error');
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

  document.getElementById('openShiftPatternPickerBtn')?.addEventListener('click', () => {
    renderShiftPatterns();
    openModal('shiftPatternModal');
  });

  document.getElementById('employeeSearch')?.addEventListener('input', renderEmployees);

  document.getElementById('shiftPatternList')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-select-shift]');
    if (!button) return;

    setShiftPattern(button.dataset.selectShift);
    closeModal('shiftPatternModal');
  });

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

      document.getElementById('inviteSummary').textContent =
        `${employee.full_name} • ${employee.personal_email || 'No personal email'} • ${employee.work_email || 'No work email'}`;

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
        showMessage('employeeMessage', 'Please select or configure a shift pattern before saving.', 'error');
        return;
      }

      const employeeId = await upsertEmployee(payload);

      await loadEmployees();

      savedEmployee =
        employees.find((employee) => employee.id === employeeId) ||
        employees.find((employee) => employee.employee_code === payload.employee_code);

      closeModal('employeeModal');

      if (savedEmployee?.onboarding_status !== 'complete') {
        document.getElementById('inviteSummary').textContent =
          `${savedEmployee.full_name} • ${savedEmployee.personal_email} • ${savedEmployee.work_email}`;

        openModal('inviteModal');
      }
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

        start_time: getField('mondayStartTime'),
        end_time: getField('mondayEndTime'),

        monday_start_time: getField('mondayStartTime'),
        monday_end_time: getField('mondayEndTime'),
        tuesday_start_time: getField('tuesdayStartTime'),
        tuesday_end_time: getField('tuesdayEndTime'),
        wednesday_start_time: getField('wednesdayStartTime'),
        wednesday_end_time: getField('wednesdayEndTime'),
        thursday_start_time: getField('thursdayStartTime'),
        thursday_end_time: getField('thursdayEndTime'),
        friday_start_time: getField('fridayStartTime'),
        friday_end_time: getField('fridayEndTime'),
        saturday_start_time: getField('saturdayStartTime'),
        saturday_end_time: getField('saturdayEndTime'),
        sunday_start_time: getField('sundayStartTime'),
        sunday_end_time: getField('sundayEndTime'),

        weekly_hours: Number(getField('shiftWeeklyHours') || 0),
        annual_allowance_days: Number(getField('shiftAnnualAllowance') || 23)
      });

      await loadShiftPatterns();
      setShiftPattern(pattern.id);
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
