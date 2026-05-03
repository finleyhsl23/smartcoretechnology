import { requireAdminPageAccess } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, showMessage } from '../../shared/ui.js';
import {
  getEmployeesByCompany,
  upsertEmployee,
  archiveEmployee,
  restoreEmployee
} from '../../shared/api.js';

let profile = null;
let employees = [];
let editingEmployee = null;

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function getStatusFilter() {
  return document.getElementById('statusFilter')?.dataset.value || 'active';
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

function getEmployeePayload() {
  return {
    id: getField('employeeId') || null,
    company_id: profile.company_id,

    employee_code: getField('employeeCode'),
    full_name: getField('fullName'),
    job_title: getField('jobTitle'),
    personal_email: getField('personalEmail'),
    work_email: getField('workEmail'),
    personal_phone: getField('personalPhone'),
    employment_type: getField('employmentType'),
    notice_period: getField('noticePeriod'),
    start_date: getField('startDate'),

    employment_status: getField('employmentStatus') || 'active',
    is_admin: getField('isAdmin') === 'true',
    role: getField('role') || 'employee',

    annual_leave_allowance: getField('annualLeaveAllowance') || 23,
    bank_holiday_region: getField('bankHolidayRegion') || 'england',
    include_bank_holidays: getField('includeBankHolidays') === 'true',

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

    onboarding_status: getField('onboardingStatus') || 'not_started',
    onboarding_token: getField('onboardingToken'),
    onboarding_expires_at: getField('onboardingExpiresAt')
      ? new Date(getField('onboardingExpiresAt')).toISOString()
      : null
  };
}

function fillEmployeeForm(employee = null) {
  editingEmployee = employee;

  document.getElementById('employeeModalTitle').textContent =
    employee ? 'Edit Employee' : 'Add Employee';

  setField('employeeId', employee?.id);
  setField('employeeCode', employee?.employee_code);
  setField('fullName', employee?.full_name);
  setField('jobTitle', employee?.job_title);
  setField('personalEmail', employee?.personal_email);
  setField('workEmail', employee?.work_email);
  setField('personalPhone', employee?.personal_phone);
  setField('employmentType', employee?.employment_type);
  setField('noticePeriod', employee?.notice_period);
  setField('startDate', employee?.start_date);

  setField('employmentStatus', employee?.employment_status || 'active');
  setField('isAdmin', String(employee?.is_admin || false));
  setField('role', employee?.role || 'employee');

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

  setField('onboardingStatus', employee?.onboarding_status || 'not_started');
  setField('onboardingToken', employee?.onboarding_token);
  setField('onboardingExpiresAt', employee?.onboarding_expires_at
    ? employee.onboarding_expires_at.slice(0, 16)
    : ''
  );
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

  list.innerHTML = filtered.map((employee) => `
    <article class="leave-card">
      <div class="leave-card-top">
        <div>
          <p class="leave-card-title">${employee.full_name || 'Employee'}</p>
          <p class="leave-card-subtitle">
            ${employee.employee_code || '—'} • ${employee.job_title || '—'} • ${employee.work_email || 'No work email'}
          </p>
          <p class="leave-card-subtitle">
            ${employee.employment_status} • ${employee.role} • Onboarding: ${employee.onboarding_status}
          </p>
        </div>

        <div class="inline-actions">
          <button class="btn btn-secondary" data-action="edit" data-id="${employee.id}" type="button">Edit</button>
          ${
            employee.employment_status === 'archived'
              ? `<button class="btn btn-primary" data-action="restore" data-id="${employee.id}" type="button">Restore</button>`
              : `<button class="btn btn-danger" data-action="archive" data-id="${employee.id}" type="button">Archive</button>`
          }
        </div>
      </div>
    </article>
  `).join('');
}

async function loadEmployees() {
  employees = await getEmployeesByCompany(profile.company_id);
  renderEmployees();
}

async function init() {
  const auth = await requireAdminPageAccess();
  if (!auth) return;

  profile = auth.profile;

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

      if (!payload.employee_code || !payload.full_name) {
        showMessage('employeeMessage', 'Employee code and full name are required.', 'error');
        return;
      }

      await upsertEmployee(payload);
      closeModal('employeeModal');
      await loadEmployees();
    } catch (error) {
      showMessage('employeeMessage', error.message || 'Unable to save employee.', 'error');
    }
  });

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
