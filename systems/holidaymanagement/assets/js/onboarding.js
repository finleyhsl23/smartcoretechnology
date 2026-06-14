import { supabase } from '../../shared/supabase.js';
import { getOnboardingInvite, completeEmployeeOnboarding } from '../../shared/api.js';
import { showMessage, setLoadingButton, revealApp, escapeHtml } from '../../shared/ui.js';

if (localStorage.getItem('holidayTheme') === 'light') document.body.classList.add('light-mode');

let invite = null;
let currentStep = 0;
let createdUserId = null;

async function init() {
  const params = new URLSearchParams(location.search);
  const token = params.get('token');

  if (!token) {
    showError('Invalid invite link. Please check your email.');
    return;
  }

  try {
    invite = await getOnboardingInvite(token);
  } catch (err) {
    showError('Failed to load invite: ' + err.message);
    return;
  }

  if (!invite) {
    showError('This invite link is invalid or has expired.');
    return;
  }

  if (invite.used_at) {
    showError('This invite has already been used. Please sign in.');
    return;
  }

  // Populate welcome step
  document.getElementById('inviteCompany').textContent = invite.companies?.name || '—';
  document.getElementById('inviteDetail').textContent =
    `You have been invited as ${invite.role || 'an employee'}${invite.full_name ? ` · ${invite.full_name}` : ''}`;
  document.getElementById('accountEmail').value = invite.email || '';
  if (invite.full_name) document.getElementById('profileName').value = invite.full_name;

  revealApp();

  // Wire buttons
  document.getElementById('step0Next').addEventListener('click', () => goTo(1));
  document.getElementById('step1Back').addEventListener('click', () => goTo(0));
  document.getElementById('step1Next').addEventListener('click', createAccount);
  document.getElementById('step2Back').addEventListener('click', () => goTo(1));
  document.getElementById('step2Next').addEventListener('click', completeSetup);
}

function showError(msg) {
  const loader = document.getElementById('appLoader');
  loader.innerHTML = `<div style="text-align:center;padding:32px">
    <p style="color:#ff9a97;margin:0 0 8px">Setup Error</p>
    <p style="color:#9fb1c9;font-size:0.9rem;margin:0">${escapeHtml(msg)}</p>
    <a href="./login.html" style="color:#9ec5ff;margin-top:16px;display:inline-block">Go to sign in</a>
  </div>`;
}

function goTo(step) {
  document.querySelectorAll('[id^="step"]').forEach((el, i) => {
    if (/^step\d$/.test(el.id)) el.classList.add('hidden');
  });
  for (let i = 0; i <= 3; i++) {
    const el = document.getElementById(`step${i}`);
    if (el) el.classList.toggle('hidden', i !== step);
  }

  // Update step indicators
  document.querySelectorAll('.onboard-step').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i < step) el.classList.add('done');
    if (i === step) el.classList.add('active');
  });

  currentStep = step;
}

async function createAccount() {
  const btn = document.getElementById('step1Next');
  const password = document.getElementById('accountPassword').value;
  const confirm = document.getElementById('accountPasswordConfirm').value;

  if (password.length < 8) {
    showMessage('step1Msg', 'Password must be at least 8 characters.', 'error');
    return;
  }
  if (password !== confirm) {
    showMessage('step1Msg', 'Passwords do not match.', 'error');
    return;
  }

  setLoadingButton(btn, true, 'Creating account...');
  showMessage('step1Msg', '', 'info');

  const { data, error } = await supabase.auth.signUp({
    email: invite.email,
    password
  });

  if (error) {
    showMessage('step1Msg', error.message, 'error');
    setLoadingButton(btn, false);
    return;
  }

  createdUserId = data.user?.id;
  setLoadingButton(btn, false);
  goTo(2);
}

async function completeSetup() {
  const btn = document.getElementById('step2Next');
  const full_name = document.getElementById('profileName').value.trim();
  const phone = document.getElementById('profilePhone').value.trim();
  const date_of_birth = document.getElementById('profileDob').value || null;
  const start_date = document.getElementById('profileStart').value || null;
  const emergency_contact_name = document.getElementById('profileEmergencyName').value.trim();
  const emergency_contact_phone = document.getElementById('profileEmergencyPhone').value.trim();

  if (!full_name) {
    showMessage('step2Msg', 'Full name is required.', 'error');
    return;
  }

  setLoadingButton(btn, true, 'Finishing setup...');
  showMessage('step2Msg', '', 'info');

  try {
    await completeEmployeeOnboarding({
      token: new URLSearchParams(location.search).get('token'),
      user_id: createdUserId,
      full_name,
      phone: phone || null,
      date_of_birth,
      start_date,
      emergency_contact_name: emergency_contact_name || null,
      emergency_contact_phone: emergency_contact_phone || null
    });
    goTo(3);
  } catch (err) {
    showMessage('step2Msg', err.message, 'error');
    setLoadingButton(btn, false);
  }
}

init();
