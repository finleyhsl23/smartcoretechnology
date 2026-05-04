import { supabase, leaveSchema } from '../../shared/supabase.js';
import { showMessage } from '../../shared/ui.js';
import { completeEmployeeOnboarding } from '../../shared/api.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

let onboardingEmployee = null;

function showOnly(id) {
  ['loadingState', 'expiredState', 'completeState', 'onboardingForm'].forEach((item) => {
    document.getElementById(item)?.classList.add('hidden');
  });

  document.getElementById(id)?.classList.remove('hidden');
}

function getValue(id) {
  return document.getElementById(id)?.value?.trim() || '';
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || '';
}

async function loadInvite() {
  if (!token) {
    showOnly('expiredState');
    return;
  }

  const { data, error } = await supabase
    .schema(leaveSchema)
    .rpc('get_onboarding_employee', {
      invite_token: token
    });

  if (error || !data || !data.length) {
    showOnly('expiredState');
    return;
  }

  onboardingEmployee = data[0];

  setValue('fullName', onboardingEmployee.full_name);
  setValue('personalEmail', onboardingEmployee.personal_email);
  setValue('personalPhone', onboardingEmployee.personal_phone);

  document.getElementById('employeeIntro').textContent =
    `Hello ${onboardingEmployee.full_name || 'there'}, please create your password and complete the rest of your employee details.`;

  showOnly('onboardingForm');
}

document.getElementById('onboardingForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const password = getValue('password');
    const confirmPassword = getValue('confirmPassword');

    if (password.length < 8) {
      showMessage('onboardingMessage', 'Password must be at least 8 characters.', 'error');
      return;
    }

    if (password !== confirmPassword) {
      showMessage('onboardingMessage', 'Passwords do not match.', 'error');
      return;
    }

    const payload = {
      full_name: getValue('fullName') || onboardingEmployee.full_name,
      personal_email: getValue('personalEmail') || onboardingEmployee.personal_email,
      personal_phone: getValue('personalPhone') || onboardingEmployee.personal_phone,
      work_email: onboardingEmployee.work_email,

      title: getValue('title'),
      pronouns: getValue('pronouns'),
      gender: getValue('gender'),
      dob: getValue('dob'),
      nationality: getValue('nationality'),
      ni_number: getValue('niNumber'),
      passport_number: getValue('passportNumber'),
      passport_expiry_date: getValue('passportExpiryDate'),
      driving_licence_number: getValue('drivingLicenceNumber'),

      address_line1: getValue('addressLine1'),
      address_line2: getValue('addressLine2'),
      address_city: getValue('addressCity'),
      address_county: getValue('addressCounty'),
      address_postcode: getValue('addressPostcode'),
      address_country: getValue('addressCountry'),

      emergency_contact_name1: getValue('emergencyContactName1'),
      emergency_contact_relationship1: getValue('emergencyContactRelationship1'),
      emergency_contact_email1: getValue('emergencyContactEmail1'),
      emergency_contact_phone1: getValue('emergencyContactPhone1'),

      emergency_contact_name2: getValue('emergencyContactName2'),
      emergency_contact_relationship2: getValue('emergencyContactRelationship2'),
      emergency_contact_email2: getValue('emergencyContactEmail2'),
      emergency_contact_phone2: getValue('emergencyContactPhone2')
    };

    showMessage('onboardingMessage', 'Creating your login and saving your details...', 'info');

    await completeEmployeeOnboarding({
      token,
      personal_email: payload.personal_email,
      password,
      employee_name: payload.full_name,
      payload
    });

    showOnly('completeState');
  } catch (error) {
    showMessage('onboardingMessage', error.message || 'Unable to save onboarding details.', 'error');
  }
});

loadInvite();
