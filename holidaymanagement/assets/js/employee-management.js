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
  createShiftPattern,
  deleteEmployeePermanent,
  getEmployeeAllLeave,
  getEmployeeLeaveBalanceByYear,
  leaveTypeLabel
} from '../../shared/api.js';

let profile = null;
let companyInfo = null;
let employees = [];
let shiftPatterns = [];
let savedEmployee = null;
let viewedEmployee = null;
let viewedLeave = [];

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? '';
}

function getField(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

function roundToNearestHalf(value) {
  return Math.round(Number(value || 0) * 2) / 2;
}

function calculateProratedAllowance(annualAllowance, startDate) {
  const allowance = Number(annualAllowance || 0);
  if (!allowance) return 0;
  if (!startDate) return allowance;

  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return allowance;

  const year = start.getFullYear();
  const endOfYear = new Date(year, 11, 31);
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const daysRemainingIncludingStartDate = Math.ceil((endOfYear - start) / millisecondsPerDay) + 1;

  return roundToNearestHalf((allowance / 365) * daysRemainingIncludingStartDate);
}

function updateOverrideAllowanceUi() {
  const enabled = document.getElementById('overrideAllowanceCalculation')?.checked === true;
  const field = document.getElementById('overrideAllowanceField');

  if (field) {
    field.classList.toggle('hidden', !enabled);
  }

  updateStartDateAllowanceHint();
}

function updateStartDateAllowanceHint() {
  const hint = document.getElementById('startDateAllowanceHint');
  if (!hint) return;

  const overrideEnabled = document.getElementById('overrideAllowanceCalculation')?.checked === true;
  const overrideValue = document.getElementById('overrideAllowanceThisYear')?.value;

  if (overrideEnabled && overrideValue !== '') {
    hint.textContent = `Executive override active. This person will have ${overrideValue} days of annual leave allowance this year.`;
    return;
  }

  const calculated = calculateProratedAllowance(
    document.getElementById('annualLeaveAllowance')?.value || 23,
    document.getElementById('startDate')?.value
  );

  hint.textContent = `This person will have ${calculated} days of annual leave allowance this year.`;
}

function cleanFileName(value) {
  return String(value || 'employee')
    .replace(/[^a-z0-9-_ ]/gi, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

function formatDate(value) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return 'Not logged in yet';

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
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

function setupCustomSelects() {
  document.querySelectorAll('.custom-select').forEach((selectEl) => {
    const trigger = selectEl.querySelector('.custom-select-trigger');
    const menu = selectEl.querySelector('.custom-select-menu');

    trigger?.addEventListener('click', (event) => {
      event.stopPropagation();

      document.querySelectorAll('.custom-select.open').forEach((openSelect) => {
        if (openSelect !== selectEl) openSelect.classList.remove('open');
      });

      selectEl.classList.toggle('open');
    });

    menu?.querySelectorAll('button[data-value]').forEach((option) => {
      option.addEventListener('click', () => {
        selectEl.dataset.value = option.dataset.value;

        const span = selectEl.querySelector('.custom-select-trigger span');
        if (span) span.textContent = option.textContent.trim();

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

function syncEmploymentTypeInputs(value = '') {
  const select = document.getElementById('employmentTypeSelect');
  const other = document.getElementById('employmentTypeOther');
  const hidden = document.getElementById('employmentType');

  if (!select || !other || !hidden) return;

  const standardValues = ['Full Time', 'Part Time'];

  if (standardValues.includes(value)) {
    select.value = value;
    other.classList.add('hidden');
    other.value = '';
    hidden.value = value;
    return;
  }

  if (value) {
    select.value = 'Other';
    other.classList.remove('hidden');
    other.value = value;
    hidden.value = value;
    return;
  }

  select.value = 'Full Time';
  other.classList.add('hidden');
  other.value = '';
  hidden.value = 'Full Time';
}

function updateEmploymentTypeFromUi() {
  const select = document.getElementById('employmentTypeSelect');
  const other = document.getElementById('employmentTypeOther');
  const hidden = document.getElementById('employmentType');

  if (!select || !other || !hidden) return;

  if (select.value === 'Other') {
    other.classList.remove('hidden');
    hidden.value = other.value.trim();
  } else {
    other.classList.add('hidden');
    other.value = '';
    hidden.value = select.value;
  }
}

function updateOwnerAuthoriserUi() {
  const isOwner = getField('role') === 'owner';
  const row = document.getElementById('noAuthoriserOwnerRow');
  const checkbox = document.getElementById('noAuthoriserRequired');
  const authoriserField = document.getElementById('authoriserField');

  row?.classList.toggle('hidden', !isOwner);

  if (!isOwner) {
    if (checkbox) checkbox.checked = false;
    authoriserField?.classList.remove('hidden');
    return;
  }

  authoriserField?.classList.toggle('hidden', checkbox?.checked === true);
}

function setAuthoriser(employee) {
  setField('assignedAuthoriserId', employee?.id || '');

  const box = document.getElementById('selectedAuthoriserBox');
  if (!box) return;

  if (!employee) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  box.classList.remove('hidden');
  box.innerHTML = `
    <strong>${employee.full_name || 'Employee'}</strong>
    <span>${employee.employee_code || '—'} • ${employee.job_title || '—'}</span>
  `;
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
    <span>${pattern.weekly_hours || '—'} hours/week</span>
  `;
}

function setEmployeeModalMode(isEditing) {
  document.querySelectorAll('[data-edit-only]').forEach((section) => {
    section.classList.toggle('hidden', !isEditing);
  });

  document.querySelectorAll('[data-edit-only] input, [data-edit-only] select, [data-edit-only] button').forEach((field) => {
    field.disabled = !isEditing;
  });

  const deleteBtn = document.getElementById('deleteEmployeeBtn');
  const exportBtn = document.getElementById('exportEmployeeBtn');

  if (deleteBtn) {
    deleteBtn.classList.toggle('hidden', !isEditing);
    deleteBtn.disabled = !isEditing;
  }

  if (exportBtn) {
    exportBtn.classList.toggle('hidden', !isEditing);
    exportBtn.disabled = !isEditing;
  }
}

function getEmployeePayload() {
  updateEmploymentTypeFromUi();

  const existingEmployee =
    savedEmployee ||
    employees.find((employee) => employee.id === getField('employeeId'));

  const isOwner = getField('role') === 'owner';
  const noAuthoriser = isOwner && document.getElementById('noAuthoriserRequired')?.checked === true;
  const overrideEnabled = document.getElementById('overrideAllowanceCalculation')?.checked === true;
  const overrideValue = getField('overrideAllowanceThisYear');

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

    annual_leave_allowance: Number(getField('annualLeaveAllowance') || 23),
    override_allowance_calculation: overrideEnabled,
    override_allowance_this_year: overrideEnabled && overrideValue !== '' ? Number(overrideValue) : null,

    bank_holiday_region: 'england',
    include_bank_holidays: getField('includeBankHolidays') === 'true',
    shift_pattern_id: getField('shiftPatternId'),

    assigned_authoriser: noAuthoriser ? '' : getField('assignedAuthoriserId'),
    no_authoriser_required: noAuthoriser,

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

  const isEditing = !!employee;
  setEmployeeModalMode(isEditing);

  setText('employeeModalTitle', employee ? 'Edit Employee' : 'Add Employee');
  setText(
    'employeeModalSubtitle',
    employee
      ? 'Edit all work and personal employee details.'
      : 'Add the basic work details. The employee completes personal details during onboarding.'
  );

  setField('employeeId', employee?.id || '');
  setField('employeeCode', employee?.employee_code || generateEmployeeCode());
  setField('fullName', employee?.full_name || '');
  setField('jobTitle', employee?.job_title || '');
  setField('workEmail', employee?.work_email || '');
  setField('personalEmail', employee?.personal_email || '');
  setField('personalPhone', employee?.personal_phone || '');

  syncEmploymentTypeInputs(employee?.employment_type || 'Full Time');

  setField('noticePeriod', employee?.notice_period || '');
  setField('startDate', employee?.start_date || '');
  setField('role', employee?.role || 'employee');
  setField('isAdmin', String(employee?.is_admin || false));
  setField('employmentStatus', employee?.employment_status || 'active');
  setField('annualLeaveAllowance', employee?.annual_leave_allowance || 23);
  setField('includeBankHolidays', String(employee?.include_bank_holidays ?? true));

  const overrideCheckbox = document.getElementById('overrideAllowanceCalculation');
  if (overrideCheckbox) {
    overrideCheckbox.checked = employee?.override_allowance_calculation === true;
  }
  setField('overrideAllowanceThisYear', employee?.override_allowance_this_year ?? '');

  setField('title', employee?.title || '');
  setField('pronouns', employee?.pronouns || '');
  setField('gender', employee?.gender || '');
  setField('dob', employee?.dob || '');
  setField('nationality', employee?.nationality || '');
  setField('niNumber', employee?.ni_number || '');
  setField('passportNumber', employee?.passport_number || '');
  setField('passportExpiryDate', employee?.passport_expiry_date || '');
  setField('drivingLicenceNumber', employee?.driving_licence_number || '');

  setField('addressLine1', employee?.address_line1 || '');
  setField('addressLine2', employee?.address_line2 || '');
  setField('addressCity', employee?.address_city || '');
  setField('addressCounty', employee?.address_county || '');
  setField('addressPostcode', employee?.address_postcode || '');
  setField('addressCountry', employee?.address_country || 'United Kingdom');

  setField('emergencyContactName1', employee?.emergency_contact_name1 || '');
  setField('emergencyContactRelationship1', employee?.emergency_contact_relationship1 || '');
  setField('emergencyContactEmail1', employee?.emergency_contact_email1 || '');
  setField('emergencyContactPhone1', employee?.emergency_contact_phone1 || '');

  setField('emergencyContactName2', employee?.emergency_contact_name2 || '');
  setField('emergencyContactRelationship2', employee?.emergency_contact_relationship2 || '');
  setField('emergencyContactEmail2', employee?.emergency_contact_email2 || '');
  setField('emergencyContactPhone2', employee?.emergency_contact_phone2 || '');

  setField('onboardingStatus', employee?.onboarding_status || 'in_progress');
  setField('onboardingExpiresAt', employee?.onboarding_expires_at ? employee.onboarding_expires_at.slice(0, 16) : '');

  const authEmployee = employees.find((item) => item.id === employee?.assigned_authoriser);
  setAuthoriser(authEmployee || null);

  const noAuthoriserCheckbox = document.getElementById('noAuthoriserRequired');
  if (noAuthoriserCheckbox) noAuthoriserCheckbox.checked = employee?.no_authoriser_required === true;

  setShiftPattern(employee?.shift_pattern_id || '');
  updateOverrideAllowanceUi();
  updateOwnerAuthoriserUi();
  updateStartDateAllowanceHint();
}

function valueOrDash(value) {
  if (value === null || value === undefined || value === '') return '—';
  return value;
}

function detailTile(label, value) {
  return `
    <div class="detail-tile">
      <span class="detail-label">${label}</span>
      <div class="detail-value">${valueOrDash(value)}</div>
    </div>
  `;
}

function renderDetailGroup(containerId, rows) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = rows.map((row) => detailTile(row.label, row.value)).join('');
}

function renderViewEmployeeDetails(employee) {
  renderDetailGroup('viewWorkDetails', [
    { label: 'Employee Code', value: employee.employee_code },
    { label: 'Full Name', value: employee.full_name },
    { label: 'Job Title', value: employee.job_title },
    { label: 'Work Email', value: employee.work_email },
    { label: 'Personal Email', value: employee.personal_email },
    { label: 'Personal Phone', value: employee.personal_phone },
    { label: 'Employment Type', value: employee.employment_type },
    { label: 'Notice Period', value: employee.notice_period },
    { label: 'Start Date', value: employee.start_date ? formatDate(employee.start_date) : '—' },
    { label: 'Role', value: employee.role },
    { label: 'Employment Status', value: employee.employment_status },
    { label: 'Authoriser Required', value: employee.no_authoriser_required ? 'No' : 'Yes' },
    { label: 'Executive Override', value: employee.override_allowance_calculation ? 'Yes' : 'No' },
    { label: 'Override Allowance This Year', value: employee.override_allowance_this_year }
  ]);

  renderDetailGroup('viewPersonalDetails', [
    { label: 'Title', value: employee.title },
    { label: 'Pronouns', value: employee.pronouns },
    { label: 'Date of Birth', value: employee.dob ? formatDate(employee.dob) : '—' },
    { label: 'National Insurance Number', value: employee.ni_number }
  ]);

  renderDetailGroup('viewAddressDetails', [
    { label: 'Address Line 1', value: employee.address_line1 },
    { label: 'Address Line 2', value: employee.address_line2 },
    { label: 'City', value: employee.address_city },
    { label: 'County', value: employee.address_county },
    { label: 'Postcode', value: employee.address_postcode },
    { label: 'Country', value: employee.address_country }
  ]);

  renderDetailGroup('viewEmergencyContact1', [
    { label: 'Name', value: employee.emergency_contact_name1 },
    { label: 'Relationship', value: employee.emergency_contact_relationship1 },
    { label: 'Email', value: employee.emergency_contact_email1 },
    { label: 'Phone', value: employee.emergency_contact_phone1 }
  ]);

  renderDetailGroup('viewEmergencyContact2', [
    { label: 'Name', value: employee.emergency_contact_name2 },
    { label: 'Relationship', value: employee.emergency_contact_relationship2 },
    { label: 'Email', value: employee.emergency_contact_email2 },
    { label: 'Phone', value: employee.emergency_contact_phone2 }
  ]);
}

function calculateYearStats(employee, leave, year, balance) {
  const yearLeave = leave.filter((item) => {
    const itemYear = new Date(item.start_date).getFullYear();
    return itemYear === Number(year);
  });

  const fallbackAllowance = Number(employee.override_allowance_this_year || employee.annual_leave_allowance || 0);

  const fallbackUsed = yearLeave
    .filter((item) =>
      item.status === 'approved' &&
      item.deduct_allowance !== false &&
      ['annual', 'other'].includes(item.leave_type)
    )
    .reduce((sum, item) => sum + Number(item.total_days || 0), 0);

  const allowance = Number(balance?.total_allowance ?? fallbackAllowance);
  const used = Number(balance?.used_days ?? fallbackUsed);
  const remaining = Number(balance?.remaining_days ?? Math.max(0, allowance - used));

  return { allowance, used, remaining, yearLeave };
}

function renderViewLeaveList(items) {
  const list = document.getElementById('viewLeaveList');
  if (!list) return;

  if (!items.length) {
    renderEmptyState(list, 'No leave records found for this year.');
    return;
  }

  list.innerHTML = items.map((item) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${leaveTypeLabel(item.leave_type)} • ${item.status}</p>
          <p class="leave-card-subtitle">${formatDate(item.start_date)} to ${formatDate(item.end_date)} • ${item.total_days || 0} day(s)</p>
        </div>
      </div>

      <div class="leave-card-bottom stacked-bottom">
        <p class="leave-card-subtitle"><strong>Reason:</strong> ${item.reason || 'No reason provided'}</p>
        <p class="leave-card-subtitle"><strong>Notes:</strong> ${item.notes || 'No notes added'}</p>
      </div>
    </article>
  `).join('');
}

async function updateViewYear() {
  if (!viewedEmployee) return;

  const year = Number(document.getElementById('viewLeaveYear')?.value || new Date().getFullYear());
  const balance = await getEmployeeLeaveBalanceByYear(viewedEmployee.user_id, year).catch(() => null);
  const stats = calculateYearStats(viewedEmployee, viewedLeave, year, balance);

  setText('viewAnnualAllowance', stats.allowance);
  setText('viewAnnualUsed', stats.used);
  setText('viewAnnualRemaining', stats.remaining);

  renderViewLeaveList(stats.yearLeave);
}

function buildYearDropdown(leave) {
  const yearSelect = document.getElementById('viewLeaveYear');
  if (!yearSelect) return;

  const currentYear = new Date().getFullYear();
  const years = new Set([currentYear]);

  leave.forEach((item) => {
    if (item.start_date) years.add(new Date(item.start_date).getFullYear());
  });

  yearSelect.innerHTML = [...years]
    .sort((a, b) => b - a)
    .map((year) => `<option value="${year}">${year}</option>`)
    .join('');

  yearSelect.value = String(currentYear);
}

async function openViewEmployee(employee) {
  viewedEmployee = employee;
  viewedLeave = await getEmployeeAllLeave(employee.id);

  setText('viewEmployeeTitle', employee.full_name || 'Employee');
  setText('viewEmployeeSubtitle', `${employee.employee_code || '—'} • ${employee.job_title || '—'}`);
  setText('viewFirstLogin', formatDateTime(employee.first_login_at));

  renderViewEmployeeDetails(employee);
  buildYearDropdown(viewedLeave);
  await updateViewYear();

  openModal('employeeViewModal');
}

function exportWorkbook(employee, leaveRecords, selectedOnly = false) {
  if (!window.XLSX) {
    alert('Excel export library has not loaded.');
    return;
  }

  const year = Number(document.getElementById('viewLeaveYear')?.value || new Date().getFullYear());

  const leaveToExport = selectedOnly
    ? leaveRecords.filter((item) => new Date(item.start_date).getFullYear() === year)
    : leaveRecords;

  const detailRows = Object.entries(employee || {}).map(([key, value]) => ({
    Field: key.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    Value: value ?? ''
  }));

  const leaveRows = leaveToExport.map((item) => ({
    Type: leaveTypeLabel(item.leave_type),
    Status: item.status || '',
    'Start Date': item.start_date || '',
    'End Date': item.end_date || '',
    'Total Days': item.total_days || 0,
    'Deduct Allowance': item.deduct_allowance === false ? 'No' : 'Yes',
    Reason: item.reason || '',
    Notes: item.notes || '',
    'Approved At': item.approved_at || '',
    'Cancelled At': item.cancelled_at || '',
    'Cancellation Reason': item.cancellation_reason || '',
    'Created At': item.created_at || ''
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), 'Employee Details');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(leaveRows.length ? leaveRows : [{ Message: 'No leave records found.' }]),
    selectedOnly ? `Leave ${year}` : 'All Leave'
  );

  XLSX.writeFile(
    wb,
    `${cleanFileName(employee.full_name || employee.employee_code)}-${selectedOnly ? year : 'all'}-leave-report.xlsx`
  );
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
          <p class="leave-card-subtitle">${pattern.weekly_hours || '—'} hours/week</p>
        </div>
        <button class="btn btn-primary" data-select-shift="${pattern.id}" type="button">Select</button>
      </div>
    </article>
  `).join('');
}

function renderEmployees() {
  const list = document.getElementById('employeesList');
  const search = document.getElementById('employeeSearch')?.value?.toLowerCase() || '';
  const status = document.getElementById('statusFilter')?.dataset.value || 'active';

  let filtered = [...employees];

  if (status !== 'all') {
    filtered = filtered.filter((employee) => employee.employment_status === status);
  }

  if (search) {
    filtered = filtered.filter((employee) =>
      JSON.stringify(employee).toLowerCase().includes(search)
    );
  }

  setText('employeeCount', `${filtered.length} employee${filtered.length === 1 ? '' : 's'} shown`);

  if (!filtered.length) {
    renderEmptyState(list, 'No employees found.');
    return;
  }

  list.innerHTML = filtered.map((employee) => {
    const shift = shiftPatterns.find((pattern) => pattern.id === employee.shift_pattern_id);
    const auth = employees.find((item) => item.id === employee.assigned_authoriser);

    return `
      <article class="leave-card">
        <div class="leave-card-top">
          <div>
            <p class="leave-card-title">${employee.full_name || 'Employee'}</p>
            <p class="leave-card-subtitle">
              ${employee.employee_code || '—'} • ${employee.job_title || '—'} • ${employee.work_email || 'No work email'}
            </p>
            <p class="leave-card-subtitle">
              ${employee.employment_status || 'active'} • ${employee.role || 'employee'} • Shift: ${shift?.name || 'Not configured'} • Authoriser: ${
                employee.no_authoriser_required ? 'Not required' : (auth?.full_name || 'Not set')
              }
            </p>
            <p class="leave-card-subtitle">
              First login: ${employee.first_login_at ? formatDateTime(employee.first_login_at) : 'Not logged in yet'}
            </p>
          </div>

          <div class="inline-actions">
            <button class="btn btn-secondary" data-action="view" data-id="${employee.id}" type="button">View</button>
            <button class="btn btn-secondary" data-action="edit" data-id="${employee.id}" type="button">Edit</button>
            <button class="btn btn-primary" data-action="invite" data-id="${employee.id}" type="button">Send Invite</button>
            ${
              employee.employment_status === 'archived'
                ? `<button class="btn btn-primary" data-action="restore" data-id="${employee.id}" type="button">Restore</button>`
                : `<button class="btn btn-danger" data-action="archive" data-id="${employee.id}" type="button">Archive</button>`
            }
            <button class="btn btn-danger" data-action="delete" data-id="${employee.id}" type="button">Delete</button>
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

  const toEmail = toType === 'personal' ? savedEmployee.personal_email : savedEmployee.work_email;

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

  const roleSelect = document.getElementById('role');
  if (profile.role !== 'owner') {
    roleSelect?.querySelector('option[value="owner"]')?.remove();
  }

  setupCustomSelects();

  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut();
    window.location.href = './login.html';
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  document.getElementById('startDate')?.addEventListener('change', updateStartDateAllowanceHint);
  document.getElementById('annualLeaveAllowance')?.addEventListener('input', updateStartDateAllowanceHint);
  document.getElementById('overrideAllowanceCalculation')?.addEventListener('change', updateOverrideAllowanceUi);
  document.getElementById('overrideAllowanceThisYear')?.addEventListener('input', updateStartDateAllowanceHint);

  document.getElementById('employmentTypeSelect')?.addEventListener('change', updateEmploymentTypeFromUi);
  document.getElementById('employmentTypeOther')?.addEventListener('input', updateEmploymentTypeFromUi);
  document.getElementById('role')?.addEventListener('change', updateOwnerAuthoriserUi);
  document.getElementById('noAuthoriserRequired')?.addEventListener('change', updateOwnerAuthoriserUi);

  document.getElementById('viewLeaveYear')?.addEventListener('change', updateViewYear);

  document.getElementById('viewLeaveRecordsBtn')?.addEventListener('click', () => {
    if (!viewedEmployee) return;

    const year = document.getElementById('viewLeaveYear')?.value || new Date().getFullYear();
    setText('leaveRecordsTitle', `${viewedEmployee.full_name || 'Employee'} Leave Records`);
    setText('leaveRecordsSubtitle', `Leave records for ${year}`);

    openModal('employeeLeaveRecordsModal');
  });

  document.getElementById('viewExportYearBtn')?.addEventListener('click', () => {
    if (viewedEmployee) exportWorkbook(viewedEmployee, viewedLeave, true);
  });

  document.getElementById('viewExportAllBtn')?.addEventListener('click', () => {
    if (viewedEmployee) exportWorkbook(viewedEmployee, viewedLeave, false);
  });

  document.getElementById('authoriserSearch')?.addEventListener('input', () => {
    const term = getField('authoriserSearch').toLowerCase();
    const box = document.getElementById('authoriserResults');

    if (!box) return;

    if (term.length < 2) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }

    const results = employees
      .filter((employee) =>
        employee.full_name?.toLowerCase().includes(term) ||
        employee.employee_code?.toLowerCase().includes(term) ||
        employee.work_email?.toLowerCase().includes(term)
      )
      .slice(0, 8);

    box.classList.remove('hidden');
    box.innerHTML = results.length
      ? results.map((employee) => `
          <button type="button" class="search-result-item" data-authoriser-id="${employee.id}">
            <strong>${employee.full_name || 'Employee'}</strong>
            <span>${employee.employee_code || '—'} • ${employee.job_title || '—'}</span>
          </button>
        `).join('')
      : `<div class="search-result-empty">No employees found.</div>`;
  });

  document.getElementById('authoriserResults')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-authoriser-id]');
    if (!button) return;

    const employee = employees.find((item) => item.id === button.dataset.authoriserId);
    setAuthoriser(employee);
    document.getElementById('authoriserResults')?.classList.add('hidden');
    setField('authoriserSearch', '');
  });

  document.getElementById('addEmployeeBtn')?.addEventListener('click', () => {
    fillEmployeeForm(null);
    openModal('employeeModal');
  });

  document.getElementById('exportEmployeeBtn')?.addEventListener('click', async () => {
    if (!savedEmployee?.id) return;
    const leave = await getEmployeeAllLeave(savedEmployee.id);
    exportWorkbook(savedEmployee, leave, false);
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

    if (button.dataset.action === 'view') {
      await openViewEmployee(employee);
    }

    if (button.dataset.action === 'edit') {
      fillEmployeeForm(employee);
      openModal('employeeModal');
    }

    if (button.dataset.action === 'invite') {
      savedEmployee = employee;
      setText(
        'inviteSummary',
        `${employee.full_name} • ${employee.personal_email || 'No personal email'} • ${employee.work_email || 'No work email'}`
      );
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

    if (button.dataset.action === 'delete') {
      if (!confirm(`Permanently delete ${employee.full_name || 'this employee'}?`)) return;
      if (!confirm('This will also try to delete their login. This cannot be undone. Continue?')) return;

      await deleteEmployeePermanent(employee.id);
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

      if (!payload.no_authoriser_required && !payload.assigned_authoriser) {
        showMessage('employeeMessage', 'Please select an authorising user.', 'error');
        return;
      }

      if (payload.override_allowance_calculation && payload.override_allowance_this_year === null) {
        showMessage('employeeMessage', 'Please enter the override allowance for this year.', 'error');
        return;
      }

      const employeeId = await upsertEmployee(payload);
      await loadEmployees();

      savedEmployee =
        employees.find((employee) => employee.id === employeeId) ||
        employees.find((employee) => employee.employee_code === payload.employee_code);

      closeModal('employeeModal');

      if (savedEmployee?.onboarding_status !== 'complete') {
        setText('inviteSummary', `${savedEmployee.full_name} • ${savedEmployee.personal_email} • ${savedEmployee.work_email}`);
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
        annual_allowance_days: 23
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
