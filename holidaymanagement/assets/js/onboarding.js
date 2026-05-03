import { supabase, leaveSchema } from '../../shared/supabase.js';
import { showMessage } from '../../shared/ui.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token');

function showOnly(id) {
  ['loadingState', 'expiredState', 'completeState', 'onboardingForm'].forEach((item) => {
    document.getElementById(item)?.classList.add('hidden');
  });

  document.getElementById(id)?.classList.remove('hidden');
}

function getValue(id) {
  return document.getElementById(id)?.value?.trim() || '';
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

  const employee = data[0];

  document.getElementById('employeeIntro').textContent =
    `Hello ${employee.full_name || 'there'}, please complete the rest of your employee details.`;

  showOnly('onboardingForm');
}

document.getElementById('onboardingForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const payload = {
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

    const { error } = await supabase
      .schema(leaveSchema)
      .rpc('complete_employee_onboarding', {
        invite_token: token,
        payload
      });

    if (error) throw error;

    showOnly('completeState');
  } catch (error) {
    showMessage('onboardingMessage', error.message || 'Unable to save onboarding details.', 'error');
  }
});

loadInvite();
