import { requireAuth, isAdminProfile } from '../../shared/guards.js';
import { signOut } from '../../shared/auth.js';
import { revealApp } from '../../shared/ui.js';
import { getMyLeaveRequests, updateMyEmployeeProfile } from '../../shared/api.js';

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

function calculateStats(profile, requests) {
  const allowance = Number(profile.annual_leave_allowance || 0);

  const used = requests
    .filter(r => r.status === 'approved' && r.deduct_allowance !== false)
    .reduce((sum, r) => sum + Number(r.total_days || 0), 0);

  return {
    allowance,
    used,
    remaining: Math.max(0, allowance - used),
    pending: requests.filter(r => r.status === 'pending').length
  };
}

function populateProfile(profile) {
  setText('profileName', profile.full_name);
  setText('profileEmail', profile.work_email || profile.personal_email);
  setText('profileRole', profile.role);
}

function populateEditForm(profile) {
  const fields = [
    'full_name','job_title','work_email','personal_email','personal_phone',
    'employment_type','notice_period','start_date','title','pronouns','gender',
    'dob','nationality','ni_number','passport_number','passport_expiry_date',
    'driving_licence_number','address_line1','address_line2','address_city',
    'address_county','address_postcode','address_country',
    'emergency_contact_name1','emergency_contact_relationship1',
    'emergency_contact_email1','emergency_contact_phone1',
    'emergency_contact_name2','emergency_contact_relationship2',
    'emergency_contact_email2','emergency_contact_phone2'
  ];

  fields.forEach(f => setInput(`edit_${f}`, profile[f]));
}

async function initHome() {
  try {
    const auth = await requireAuth();
    if (!auth) return;

    const { profile, user } = auth;
    const userId = profile.user_id || user.id;

    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
      await signOut();
      location.href = './login.html';
    });

    populateProfile(profile);
    populateEditForm(profile);

    const requests = await getMyLeaveRequests(userId);
    const stats = calculateStats(profile, requests);

    setText('profileRemaining', stats.remaining);
    setText('profileUsed', stats.used);
    setText('profilePending', stats.pending);

    document.getElementById('profileEditForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      await updateMyEmployeeProfile(profile, {
        full_name: getInput('edit_full_name'),
        job_title: getInput('edit_job_title'),
        work_email: getInput('edit_work_email'),
        personal_email: getInput('edit_personal_email'),
        personal_phone: getInput('edit_personal_phone'),
        employment_type: getInput('edit_employment_type'),
        notice_period: getInput('edit_notice_period'),
        start_date: getInput('edit_start_date'),

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
      });

      location.reload();
    });

    revealApp();

  } catch (err) {
    console.error(err);
    document.getElementById('appLoader').innerHTML = 'Dashboard failed to load';
  }
}

initHome();
