import { requireAuth, isAdminProfile } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp, renderEmptyState, showMessage } from '../../shared/ui.js';
import {
  getDashboardLeaveBreakdown,
  getMyLeaveRequests,
  getMyLeaveBalance,
  leaveTypeLabel,
  updateMyEmployeeProfile
} from '../../shared/api.js';
import { formatDate } from '../../shared/dates.js';

let currentProfile = null;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? '—';
}

function getInput(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function setInput(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

function show(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function hide(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function titleCase(value) {
  const text = String(value || '').trim();
  if (!text) return '—';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

function calculateLeaveStatsFromBalance(profile, requests, balance) {
  const fallbackAllowance = Number(profile.annual_leave_allowance || 0);

  const fallbackUsed = (requests || [])
    .filter((request) =>
      request.status === 'approved' &&
      request.deduct_allowance !== false &&
      ['annual', 'other'].includes(request.leave_type)
    )
    .reduce((sum, request) => sum + Number(request.total_days || 0), 0);

  const allowance = Number(balance?.total_allowance ?? fallbackAllowance);
  const used = Number(balance?.used_days ?? fallbackUsed);
  const remaining = Number(balance?.remaining_days ?? Math.max(0, allowance - used));

  return {
    allowance,
    used,
    remaining,
    pending: (requests || []).filter((request) => request.status === 'pending').length
  };
}

function renderLeaveList(containerId, items, emptyText) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items || !items.length) {
    renderEmptyState(container, emptyText);
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="leave-card">
      <p class="leave-card-title">${item.employee_name || item.display_name || item.full_name || 'Employee'}</p>
      <p class="leave-card-subtitle">
        ${leaveTypeLabel(item.leave_type)} • ${formatDate(item.start_date)} to ${formatDate(item.end_date)}
      </p>
      <p class="leave-card-subtitle">
        ${item.total_days || 0} day(s) ${item.reason ? `• ${item.reason}` : ''}
      </p>
    </article>
  `).join('');
}

function renderBirthdayList(containerId, items, emptyText = 'No birthdays in the next 7 days.', type = 'birthday') {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items || !items.length) {
    renderEmptyState(container, emptyText);
    return;
  }

  container.innerHTML = items.map((employee) => {
    const label = type === 'anniversary' ? 'Start date' : 'Birthday';
    const date = type === 'anniversary' ? employee.start_date : employee.dob;

    return `
      <article class="leave-card">
        <p class="leave-card-title">${employee.full_name || employee.display_name || 'Employee'}</p>
        <p class="leave-card-subtitle">
          ${date ? `${label}: ${formatDate(date)}` : 'Date not set'}
        </p>
      </article>
    `;
  }).join('');
}

function populateEditForm(profile) {
  [
    'full_name',
    'job_title',
    'work_email',
    'personal_email',
    'personal_phone',
    'employment_type',
    'notice_period',
    'start_date',
    'title',
    'pronouns',
    'gender',
    'dob',
    'nationality',
    'ni_number',
    'passport_number',
    'passport_expiry_date',
    'driving_licence_number',
    'address_line1',
    'address_line2',
    'address_city',
    'address_county',
    'address_postcode',
    'address_country',
    'emergency_contact_name1',
    'emergency_contact_relationship1',
    'emergency_contact_email1',
    'emergency_contact_phone1',
    'emergency_contact_name2',
    'emergency_contact_relationship2',
    'emergency_contact_email2',
    'emergency_contact_phone2'
  ].forEach((field) => setInput(`edit_${field}`, profile[field]));
}

function getEditPayload() {
  return {
    full_name: getInput('edit_full_name'),
    job_title: currentProfile?.job_title || '',
    work_email: getInput('edit_work_email'),
    personal_email: getInput('edit_personal_email'),
    personal_phone: getInput('edit_personal_phone'),
    employment_type: currentProfile?.employment_type || '',
    notice_period: currentProfile?.notice_period || '',
    start_date: currentProfile?.start_date || '',

    title: getInput('edit_title'),
    pronouns: getInput('edit_pronouns'),
    gender: getInput('edit_gender'),
    dob: getInput('edit_dob'),
    nationality: getInput('edit_nationality'),
    ni_number: getInput('edit_ni_number'),
    passport_number: getInput('edit_passport_number'),
    passport_expiry_date: getInput('edit_passport_expiry_date'),
    driving_licence_number: getInput('edit_driving_licence_number'),

    address_line1: getInput('edit_address_line1'),
    address_line2: getInput('edit_address_line2'),
    address_city: getInput('edit_address_city'),
    address_county: getInput('edit_address_county'),
    address_postcode: getInput('edit_address_postcode'),
    address_country: getInput('edit_address_country'),

    emergency_contact_name1: getInput('edit_emergency_contact_name1'),
    emergency_contact_relationship1: getInput('edit_emergency_contact_relationship1'),
    emergency_contact_email1: getInput('edit_emergency_contact_email1'),
    emergency_contact_phone1: getInput('edit_emergency_contact_phone1'),

    emergency_contact_name2: getInput('edit_emergency_contact_name2'),
    emergency_contact_relationship2: getInput('edit_emergency_contact_relationship2'),
    emergency_contact_email2: getInput('edit_emergency_contact_email2'),
    emergency_contact_phone2: getInput('edit_emergency_contact_phone2')
  };
}

function setupDashboardPanelClicks() {
  document.querySelectorAll('[data-panel-target]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.dashboard-detail-panel').forEach((panel) => {
        panel.classList.add('hidden');
      });

      document.querySelectorAll('.stat-button').forEach((stat) => {
        stat.classList.remove('active-stat-button');
      });

      document.getElementById(button.dataset.panelTarget)?.classList.remove('hidden');
      button.classList.add('active-stat-button');
    });
  });
}

function isTodayInRange(item, todayIso) {
  return item.start_date <= todayIso && item.end_date >= todayIso;
}

async function initHome() {
  try {
    const auth = await requireAuth();
    if (!auth) return;

    const { user, profile } = auth;
    currentProfile = profile;

    const authUserId = profile.user_id || profile.auth_user_id || user.id;
    const displayName = profile.full_name || user.email || 'Employee';
    const displayEmail = profile.work_email || profile.email || profile.personal_email || user.email || '—';
    const isAdmin = isAdminProfile(profile);
    const todayIso = new Date().toISOString().slice(0, 10);
    const currentYear = new Date().getFullYear();

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      window.location.href = './login.html';
    });

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
      button.addEventListener('click', () => closeModal(button.dataset.closeModal));
    });

    document.getElementById('editProfileBtn')?.addEventListener('click', () => {
      populateEditForm(currentProfile);
      openModal('profileEditModal');
    });

    document.getElementById('profileEditForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();

      try {
        showMessage('profileEditMessage', 'Saving profile...', 'info');
        await updateMyEmployeeProfile(currentProfile, getEditPayload());
        showMessage('profileEditMessage', 'Profile updated. Refreshing...', 'success');
        setTimeout(() => window.location.reload(), 600);
      } catch (error) {
        showMessage('profileEditMessage', error.message || 'Unable to update profile.', 'error');
      }
    });

    setupDashboardPanelClicks();

    setText('welcomeText', `Welcome back, ${displayName}`);
    setText('profileName', displayName);
    setText('profileEmail', displayEmail);
    setText('profileRole', titleCase(profile.role));

    let myRequests = [];
    let balance = null;

    try {
      myRequests = await getMyLeaveRequests(authUserId);
    } catch (error) {
      console.warn('My requests failed:', error);
    }

    try {
      balance = await getMyLeaveBalance(authUserId, currentYear);
    } catch (error) {
      console.warn('Balance failed:', error);
    }

    const stats = calculateLeaveStatsFromBalance(profile, myRequests, balance);

    setText('profileAllowance', stats.allowance);
    setText('profileUsed', stats.used);
    setText('profileRemaining', stats.remaining);
    setText('profilePending', stats.pending);

    if (!isAdmin) {
      hide('adminDashboardSection');
      show('personalProfileSection');
      revealApp();
      return;
    }

    show('adminDashboardSection');
    show('personalProfileSection');

    let breakdown = {
      annualToday: [],
      sickToday: [],
      otherToday: [],
      annualNext7: [],
      sickNext7: [],
      otherNext7: [],
      birthdaysNext7: [],
      workAnniversariesNext7: []
    };

    try {
      breakdown = await getDashboardLeaveBreakdown(profile.company_id);
    } catch (error) {
      console.warn('Dashboard breakdown failed:', error);
    }

    const annualToday = (breakdown.annualToday || []).filter((item) => isTodayInRange(item, todayIso));
    const sickToday = (breakdown.sickToday || []).filter((item) => isTodayInRange(item, todayIso));
    const otherToday = (breakdown.otherToday || []).filter((item) => isTodayInRange(item, todayIso));

    setText('annualTodayCount', annualToday.length);
    setText('sickTodayCount', sickToday.length);
    setText('otherTodayCount', otherToday.length);
    setText('birthdaysCount', breakdown.birthdaysNext7?.length || 0);
    setText('anniversariesCount', breakdown.workAnniversariesNext7?.length || 0);

    renderLeaveList('annualTodayList', annualToday, 'Nobody is on annual leave today.');
    renderLeaveList('annualNext7List', breakdown.annualNext7 || [], 'No annual leave in the next 7 days.');

    renderLeaveList('sickTodayList', sickToday, 'Nobody is on sick leave today.');
    renderLeaveList('sickNext7List', breakdown.sickNext7 || [], 'No sick leave in the next 7 days.');

    renderLeaveList('otherTodayList', otherToday, 'Nobody is on other leave today.');
    renderLeaveList('otherNext7List', breakdown.otherNext7 || [], 'No other leave in the next 7 days.');

    renderBirthdayList('birthdaysNext7List', breakdown.birthdaysNext7 || []);
    renderBirthdayList('anniversariesNext7List', breakdown.workAnniversariesNext7 || [], 'No work anniversaries in the next 7 days.', 'anniversary');

    revealApp();
  } catch (error) {
    console.error('Dashboard failed to load:', error);

    const loader = document.getElementById('appLoader');
    if (loader) {
      loader.innerHTML = `
        <div style="padding:24px;text-align:center;">
          <h2>Dashboard failed to load</h2>
          <p>${error.message || 'Unknown error'}</p>
        </div>
      `;
    }
  }
}

initHome();
