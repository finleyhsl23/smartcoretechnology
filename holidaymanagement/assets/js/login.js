import { requireGuest } from '../../shared/guards.js';
import { signInWithPassword } from '../../shared/auth.js';
import { showMessage, setLoadingButton } from '../../shared/ui.js';
import { supabase, leaveSchema } from '../../shared/supabase.js';

const form = document.getElementById('loginForm');
const submitButton = form?.querySelector('button[type="submit"]');

await requireGuest();

async function markFirstLogin() {
  const { error } = await supabase
    .schema(leaveSchema)
    .rpc('mark_my_first_login');

  if (error) {
    console.warn('First login update failed:', error);
  }
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('loginMessage', '');

  const formData = new FormData(form);
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');

  try {
    setLoadingButton(submitButton, true, 'Signing in...');

    const { error } = await signInWithPassword(email, password);
    if (error) throw error;

    await markFirstLogin();

    window.location.href = './home.html';
  } catch (error) {
    console.error(error);
    showMessage('loginMessage', error.message || 'Unable to sign in.', 'error');
  } finally {
    setLoadingButton(submitButton, false);
  }
});
