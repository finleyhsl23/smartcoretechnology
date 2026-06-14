import { supabase } from '../../shared/supabase.js';
import { showMessage, setLoadingButton } from '../../shared/ui.js';

const form = document.getElementById('loginForm');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');

// Apply saved theme
if (localStorage.getItem('holidayTheme') === 'light') {
  document.body.classList.add('light-mode');
}

// If already signed in, go to company selector
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) window.location.href = '/holidaymanagement/select-company.html';
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  setLoadingButton(loginBtn, true, 'Signing in...');
  showMessage('loginMsg', '', 'info');

  const { error } = await supabase.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value
  });

  if (error) {
    showMessage('loginMsg', error.message, 'error');
    setLoadingButton(loginBtn, false);
  } else {
    window.location.href = '/holidaymanagement/select-company.html';
  }
});
