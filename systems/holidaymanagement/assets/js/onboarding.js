import { supabase, db } from '../../shared/supabase.js';
import { showMessage, setLoadingButton, escapeHtml, revealApp } from '../../shared/ui.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let invite = null;
let currentStep = 0;
let createdUserId = null;
let requiredFields = new Set();

// Collected data across steps (assembled on final submit)
const formData = {};

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------
async function init() {
  if (localStorage.getItem('holidayTheme') === 'light') {
    document.body.classList.add('light-mode');
  }

  const params = new URLSearchParams(location.search);
  const token = params.get('token');

  if (!token) {
    showError('Invalid invite link. Please check your email for the correct link.');
    return;
  }

  // Load invite from Supabase
  let inviteError;
  try {
    const { data, error } = await db
      .from('onboarding_invites')
      .select('*, companies(name)')
      .eq('token', token)
      .single();

    if (error) throw error;
    invite = data;
  } catch (err) {
    inviteError = err;
  }

  if (inviteError || !invite) {
    showError('This invite link is invalid or has expired. Please contact your HR team.');
    return;
  }

  if (invite.used_at) {
    showError('This invite has already been used. Please sign in to your account.');
    return;
  }

  // Load company onboarding field settings
  try {
    const { data: fieldSettings } = await db
      .from('onboarding_field_settings')
      .select('*')
      .eq('company_id', invite.company_id);

    if (fieldSettings && fieldSettings.length) {
      fieldSettings.forEach(s => {
        if (s.required) requiredFields.add(s.field_key);
      });
    }
  } catch (_) {
    // Non-fatal — proceed with defaults
  }

  // Apply dynamic required/optional labels based on company settings
  applyFieldSettings();

  // Pre-fill fields
  const emailEl = document.getElementById('accountEmail');
  if (emailEl) emailEl.value = invite.email || invite.work_email || '';

  const fullNameEl = document.getElementById('personalFullName');
  if (fullNameEl && invite.full_name) fullNameEl.value = invite.full_name;

  const personalEmailEl = document.getElementById('personalEmail');
  if (personalEmailEl && invite.personal_email) personalEmailEl.value = invite.personal_email;

  // Welcome step content
  document.getElementById('inviteCompany').textContent =
    invite.companies?.name || invite.company_name || '—';
  document.getElementById('inviteDetail').textContent =
    `You have been invited as ${invite.role || 'an employee'}` +
    (invite.full_name ? ` · ${invite.full_name}` : '');

  revealApp();
  wireEvents();
}

// ---------------------------------------------------------------------------
// Apply company field settings (required/optional badges)
// ---------------------------------------------------------------------------
function applyFieldSettings() {
  const optionalFields = {
    preferredNameBadge: 'preferred_name',
    pronounsBadge: 'pronouns',
    dobBadge: 'date_of_birth',
    genderBadge: 'gender',
  };

  for (const [badgeId, fieldKey] of Object.entries(optionalFields)) {
    const badge = document.getElementById(badgeId);
    if (!badge) continue;
    if (requiredFields.has(fieldKey)) {
      badge.textContent = '*';
      badge.style.opacity = '1';
    } else if (fieldKey === 'date_of_birth') {
      // Date of birth is required by default unless company opts out
      if (!requiredFields.has('dob_optional')) {
        badge.textContent = '*';
        badge.style.opacity = '1';
      } else {
        badge.textContent = '(optional)';
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Wire all event listeners
// ---------------------------------------------------------------------------
function wireEvents() {
  // Step 0
  document.getElementById('step0Next').addEventListener('click', () => goTo(1));

  // Step 1
  document.getElementById('step1Back').addEventListener('click', () => goTo(0));
  document.getElementById('step1Next').addEventListener('click', handleStep1);

  // Step 2
  document.getElementById('step2Back').addEventListener('click', () => goTo(1));
  document.getElementById('step2Next').addEventListener('click', handleStep2);

  // Step 3
  document.getElementById('step3Back').addEventListener('click', () => goTo(2));
  document.getElementById('step3Next').addEventListener('click', handleStep3);

  // Step 4
  document.getElementById('step4Back').addEventListener('click', () => goTo(3));
  document.getElementById('step4Next').addEventListener('click', handleStep4);
  document.getElementById('addEc2Btn').addEventListener('click', showEc2);
  document.getElementById('removeEc2Btn').addEventListener('click', hideEc2);

  // Step 5
  document.getElementById('step5Back').addEventListener('click', () => goTo(4));
  document.getElementById('step5Next').addEventListener('click', handleStep5);

  // Phone number fields — digits only
  const phoneInputIds = [
    'personalPhoneNumber',
    'ec1PhoneNumber',
    'ec2PhoneNumber',
  ];
  phoneInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        el.value = el.value.replace(/\D/g, '');
      });
    }
  });

  // Sort code auto-formatting: XX-XX-XX
  const sortCodeEl = document.getElementById('finSortCode');
  if (sortCodeEl) {
    sortCodeEl.addEventListener('input', formatSortCode);
  }

  // Account number — digits only
  const accountNumEl = document.getElementById('finAccountNumber');
  if (accountNumEl) {
    accountNumEl.addEventListener('input', () => {
      accountNumEl.value = accountNumEl.value.replace(/\D/g, '').slice(0, 8);
    });
  }

  // NINO — uppercase
  const ninoEl = document.getElementById('personalNino');
  if (ninoEl) {
    ninoEl.addEventListener('input', () => {
      ninoEl.value = ninoEl.value.toUpperCase();
    });
  }

  // Postcode — uppercase
  const postcodeEl = document.getElementById('addrPostcode');
  if (postcodeEl) {
    postcodeEl.addEventListener('input', () => {
      postcodeEl.value = postcodeEl.value.toUpperCase();
    });
  }

  // Tax code — uppercase
  const taxCodeEl = document.getElementById('finTaxCode');
  if (taxCodeEl) {
    taxCodeEl.addEventListener('input', () => {
      taxCodeEl.value = taxCodeEl.value.toUpperCase();
    });
  }
}

// ---------------------------------------------------------------------------
// Sort code formatter — auto-inserts dashes: XX-XX-XX
// ---------------------------------------------------------------------------
function formatSortCode(e) {
  const el = e.target;
  // Strip all non-digits
  let raw = el.value.replace(/\D/g, '').slice(0, 6);
  // Insert dashes
  let formatted = '';
  for (let i = 0; i < raw.length; i++) {
    if (i === 2 || i === 4) formatted += '-';
    formatted += raw[i];
  }
  el.value = formatted;
}

// ---------------------------------------------------------------------------
// Step navigation
// ---------------------------------------------------------------------------
function goTo(step) {
  const totalSteps = 7; // 0-6
  for (let i = 0; i < totalSteps; i++) {
    const el = document.getElementById(`step${i}`);
    if (el) el.classList.toggle('hidden', i !== step);
  }

  // Update step indicator circles
  document.querySelectorAll('.onboard-step').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i < step) {
      el.classList.add('done');
      const circle = el.querySelector('.onboard-step-circle');
      if (circle) circle.textContent = '✓';
    } else {
      const circle = el.querySelector('.onboard-step-circle');
      // Restore numeric label for incomplete steps (use data-step + 1, except last which is already ✓)
      if (circle && i < 6) circle.textContent = String(i + 1);
      if (i === step) el.classList.add('active');
    }
  });

  // Scroll the steps row so the active step is visible
  const activeStep = document.querySelector('.onboard-step.active');
  if (activeStep) {
    activeStep.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  currentStep = step;
  // Clear any lingering messages when navigating
  clearMessages();
}

function clearMessages() {
  document.querySelectorAll('.form-message').forEach(el => {
    el.textContent = '';
    el.className = 'form-message';
  });
}

// ---------------------------------------------------------------------------
// Step 1: Create account
// ---------------------------------------------------------------------------
async function handleStep1() {
  const btn = document.getElementById('step1Next');
  const email = document.getElementById('accountEmail').value.trim();
  const password = document.getElementById('accountPassword').value;
  const confirm = document.getElementById('accountPasswordConfirm').value;

  if (!email) {
    showMessage('step1Msg', 'Email address is missing.', 'error');
    return;
  }
  if (password.length < 8) {
    showMessage('step1Msg', 'Password must be at least 8 characters.', 'error');
    return;
  }
  if (password !== confirm) {
    showMessage('step1Msg', 'Passwords do not match. Please re-enter.', 'error');
    return;
  }

  setLoadingButton(btn, true, 'Creating account…');
  showMessage('step1Msg', '', 'info');

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    showMessage('step1Msg', error.message, 'error');
    setLoadingButton(btn, false);
    return;
  }

  createdUserId = data?.user?.id || null;
  formData.email = email;

  setLoadingButton(btn, false);
  goTo(2);
}

// ---------------------------------------------------------------------------
// Step 2: Personal details
// ---------------------------------------------------------------------------
function handleStep2() {
  const title = document.getElementById('personalTitle').value;
  const fullName = document.getElementById('personalFullName').value.trim();
  const preferredName = document.getElementById('personalPreferredName').value.trim();
  const pronouns = document.getElementById('personalPronouns').value.trim();
  const personalEmail = document.getElementById('personalEmail').value.trim();
  const phoneCode = document.getElementById('personalPhoneCode').value;
  const phoneNumber = document.getElementById('personalPhoneNumber').value.trim();
  const dob = document.getElementById('personalDob').value || null;
  const gender = document.getElementById('personalGender').value.trim();
  const nino = document.getElementById('personalNino').value.trim();

  // Validation
  if (!title) {
    showMessage('step2Msg', 'Please select a title.', 'error');
    return;
  }
  if (!fullName) {
    showMessage('step2Msg', 'Full name is required.', 'error');
    return;
  }
  if (requiredFields.has('preferred_name') && !preferredName) {
    showMessage('step2Msg', 'Preferred name is required by your company settings.', 'error');
    return;
  }
  if (requiredFields.has('pronouns') && !pronouns) {
    showMessage('step2Msg', 'Pronouns are required by your company settings.', 'error');
    return;
  }
  if (!personalEmail || !isValidEmail(personalEmail)) {
    showMessage('step2Msg', 'A valid personal email address is required.', 'error');
    return;
  }
  if (!phoneNumber) {
    showMessage('step2Msg', 'Personal phone number is required.', 'error');
    return;
  }
  // DOB: required unless company opted out
  const dobOptional = requiredFields.has('dob_optional');
  if (!dobOptional && !dob) {
    showMessage('step2Msg', 'Date of birth is required.', 'error');
    return;
  }
  if (requiredFields.has('gender') && !gender) {
    showMessage('step2Msg', 'Gender is required by your company settings.', 'error');
    return;
  }

  // Normalise phone code (Canada uses +1-CA)
  const phoneCodeNorm = phoneCode === '+1-CA' ? '+1' : phoneCode;

  Object.assign(formData, {
    title,
    full_name: fullName,
    preferred_name: preferredName || null,
    pronouns: pronouns || null,
    personal_email: personalEmail,
    phone: phoneNumber ? `${phoneCodeNorm}${phoneNumber}` : null,
    date_of_birth: dob,
    gender: gender || null,
    national_insurance_number: nino || null,
  });

  goTo(3);
}

// ---------------------------------------------------------------------------
// Step 3: Address
// ---------------------------------------------------------------------------
function handleStep3() {
  const line1 = document.getElementById('addrLine1').value.trim();
  const line2 = document.getElementById('addrLine2').value.trim();
  const city = document.getElementById('addrCity').value.trim();
  const county = document.getElementById('addrCounty').value.trim();
  const postcode = document.getElementById('addrPostcode').value.trim();
  const country = document.getElementById('addrCountry').value.trim();

  if (!line1) {
    showMessage('step3Msg', 'Address line 1 is required.', 'error');
    return;
  }
  if (!city) {
    showMessage('step3Msg', 'City is required.', 'error');
    return;
  }
  if (!postcode) {
    showMessage('step3Msg', 'Postcode is required.', 'error');
    return;
  }
  if (!country) {
    showMessage('step3Msg', 'Country is required.', 'error');
    return;
  }

  Object.assign(formData, {
    address_line1: line1,
    address_line2: line2 || null,
    city,
    county: county || null,
    postcode,
    country,
  });

  goTo(4);
}

// ---------------------------------------------------------------------------
// Step 4: Emergency contacts
// ---------------------------------------------------------------------------
function handleStep4() {
  const ec1Name = document.getElementById('ec1Name').value.trim();
  const ec1Relationship = document.getElementById('ec1Relationship').value.trim();
  const ec1Email = document.getElementById('ec1Email').value.trim();
  const ec1PhoneCode = document.getElementById('ec1PhoneCode').value;
  const ec1PhoneNumber = document.getElementById('ec1PhoneNumber').value.trim();

  if (!ec1Name) {
    showMessage('step4Msg', 'Emergency contact name is required.', 'error');
    return;
  }
  if (!ec1Relationship) {
    showMessage('step4Msg', 'Relationship to emergency contact is required.', 'error');
    return;
  }
  if (!ec1PhoneNumber) {
    showMessage('step4Msg', 'Emergency contact phone number is required.', 'error');
    return;
  }

  const ec1PhoneCodeNorm = ec1PhoneCode === '+1-CA' ? '+1' : ec1PhoneCode;

  formData.emergency_contact_1 = {
    name: ec1Name,
    relationship: ec1Relationship,
    email: ec1Email || null,
    phone: `${ec1PhoneCodeNorm}${ec1PhoneNumber}`,
  };

  // Second emergency contact (optional)
  const ec2Section = document.getElementById('ec2Section');
  if (!ec2Section.classList.contains('hidden')) {
    const ec2Name = document.getElementById('ec2Name').value.trim();
    const ec2Relationship = document.getElementById('ec2Relationship').value.trim();
    const ec2Email = document.getElementById('ec2Email').value.trim();
    const ec2PhoneCode = document.getElementById('ec2PhoneCode').value;
    const ec2PhoneNumber = document.getElementById('ec2PhoneNumber').value.trim();

    // Only include if at least a name is provided
    if (ec2Name) {
      const ec2PhoneCodeNorm = ec2PhoneCode === '+1-CA' ? '+1' : ec2PhoneCode;
      formData.emergency_contact_2 = {
        name: ec2Name,
        relationship: ec2Relationship || null,
        email: ec2Email || null,
        phone: ec2PhoneNumber ? `${ec2PhoneCodeNorm}${ec2PhoneNumber}` : null,
      };
    } else {
      formData.emergency_contact_2 = null;
    }
  } else {
    formData.emergency_contact_2 = null;
  }

  goTo(5);
}

// ---------------------------------------------------------------------------
// Step 5: Employment & Financial — final submit
// ---------------------------------------------------------------------------
async function handleStep5() {
  const btn = document.getElementById('step5Next');

  const studentLoan = document.getElementById('finStudentLoan').value || null;
  const taxCode = document.getElementById('finTaxCode').value.trim() || null;
  const bankName = document.getElementById('finBankName').value.trim() || null;
  const sortCode = document.getElementById('finSortCode').value.trim() || null;
  const accountNumber = document.getElementById('finAccountNumber').value.trim() || null;
  const dietary = document.getElementById('finDietary').value.trim() || null;
  const accessibility = document.getElementById('finAccessibility').value.trim() || null;

  // Sort code format validation (if provided)
  if (sortCode && !/^\d{2}-\d{2}-\d{2}$/.test(sortCode)) {
    showMessage('step5Msg', 'Sort code must be in the format XX-XX-XX.', 'error');
    return;
  }

  // Account number validation (if provided)
  if (accountNumber && !/^\d{8}$/.test(accountNumber)) {
    showMessage('step5Msg', 'Account number must be exactly 8 digits.', 'error');
    return;
  }

  Object.assign(formData, {
    student_loan_plan: studentLoan,
    tax_code: taxCode,
    bank_account_name: bankName,
    bank_sort_code: sortCode,
    bank_account_number: accountNumber,
    dietary_requirements: dietary,
    accessibility_needs: accessibility,
  });

  setLoadingButton(btn, true, 'Saving your details…');
  showMessage('step5Msg', '', 'info');

  const token = new URLSearchParams(location.search).get('token');

  try {
    const response = await fetch('/holidaymanagement/complete-onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        user_id: createdUserId,
        ...formData,
      }),
    });

    if (!response.ok) {
      let errMsg = `Server error (${response.status})`;
      try {
        const errBody = await response.json();
        errMsg = errBody.message || errBody.error || errMsg;
      } catch (_) {}
      throw new Error(errMsg);
    }

    setLoadingButton(btn, false);
    goTo(6);
  } catch (err) {
    showMessage('step5Msg', err.message, 'error');
    setLoadingButton(btn, false);
  }
}

// ---------------------------------------------------------------------------
// Second emergency contact toggle
// ---------------------------------------------------------------------------
function showEc2() {
  document.getElementById('ec2Section').classList.remove('hidden');
  document.getElementById('ec2Toggle').classList.add('hidden');
}

function hideEc2() {
  document.getElementById('ec2Section').classList.add('hidden');
  document.getElementById('ec2Toggle').classList.remove('hidden');
  // Clear ec2 fields
  ['ec2Name', 'ec2Relationship', 'ec2Email', 'ec2PhoneNumber'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const ec2PhoneCode = document.getElementById('ec2PhoneCode');
  if (ec2PhoneCode) ec2PhoneCode.selectedIndex = 0;
}

// ---------------------------------------------------------------------------
// Error state (full-page, replaces loader)
// ---------------------------------------------------------------------------
function showError(msg) {
  const loader = document.getElementById('appLoader');
  if (loader) {
    loader.innerHTML = `
      <div style="text-align:center;padding:32px;max-width:400px;margin:0 auto">
        <p style="color:#ff9a97;margin:0 0 8px;font-weight:700;font-size:1.1rem">Setup Error</p>
        <p style="color:#9fb1c9;font-size:0.9rem;margin:0 0 16px">${escapeHtml(msg)}</p>
        <a href="./login.html" style="color:#9ec5ff;font-size:0.9rem">Go to Sign In →</a>
      </div>
    `;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
init();
