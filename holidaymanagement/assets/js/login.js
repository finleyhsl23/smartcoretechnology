import { requireGuest } from '../../shared/guards.js';
import { signInWithPassword } from '../../shared/auth.js';
import { showMessage, setLoadingButton } from '../../shared/ui.js';
import { supabase, leaveSchema } from '../../shared/supabase.js';

const form = document.getElementById('loginForm');
const submitButton = form?.querySelector('button[type="submit"]');

await requireGuest();

async function markFirstLogin(userId) {
  if (!userId) return;

  const { error } = await supabase
    .schema(leaveSchema)
    .from('employees')
    .update({
      first_login_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .is('first_login_at', null);

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

    const { data, error } = await signInWithPassword(email, password);
    if (error) throw error;

    const userId = data?.user?.id || data?.session?.user?.id;

    await markFirstLogin(userId);

    window.location.href = './home.html';
  } catch (error) {
    console.error(error);
    showMessage('loginMessage', error.message || 'Unable to sign in.', 'error');
  } finally {
    setLoadingButton(submitButton, false);
  }
});
