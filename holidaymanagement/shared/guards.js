import { supabase, leaveSchema } from './supabase.js';

export async function getSessionOrRedirect() {
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    window.location.href = './login.html';
    return null;
  }

  return data.session;
}

export async function requireGuest() {
  const { data } = await supabase.auth.getSession();

  if (data?.session) {
    window.location.href = './home.html';
  }
}

export async function getCurrentProfile() {
  const { data, error } = await supabase
    .schema(leaveSchema)
    .rpc('get_current_employee_profile');

  if (error) throw error;

  const profile = data?.[0];

  if (!profile || !profile.active) {
    throw new Error('Your employee profile is missing or inactive.');
  }

  return profile;
}

export function isAdminProfile(profile) {
  return (
    profile?.is_admin === true ||
    ['admin', 'owner'].includes(String(profile?.role || '').toLowerCase())
  );
}

export function applyRoleUi(profile) {
  const isAdmin = isAdminProfile(profile);

  document.querySelectorAll('#adminNavLink, [data-admin-only], .admin-only-link').forEach((el) => {
    el.classList.toggle('hidden', !isAdmin);
    el.style.display = isAdmin ? '' : 'none';
  });

  document.querySelectorAll('a[href="./admin.html"], a[href="./employee-management.html"]').forEach((el) => {
    el.classList.toggle('hidden', !isAdmin);
    el.style.display = isAdmin ? '' : 'none';
  });

  return isAdmin;
}

export async function requireAuth() {
  const session = await getSessionOrRedirect();
  if (!session) return null;

  const profile = await getCurrentProfile();

  const fixedProfile = {
    ...profile,
    auth_user_id: session.user.id,
    user_id: session.user.id,
    employee_id: profile.id
  };

  if (!document.getElementById('themeToggleBtn')) {
  const button = document.createElement('button');
  button.id = 'themeToggleBtn';
  button.className = 'btn theme-toggle-btn';
  button.type = 'button';

  const savedTheme = localStorage.getItem('holidayTheme') || 'dark';
  document.body.classList.toggle('light-mode', savedTheme === 'light');
  button.textContent = savedTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';

  button.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('holidayTheme', isLight ? 'light' : 'dark');
    button.textContent = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  });

  document.body.appendChild(button);
}
  
  applyRoleUi(fixedProfile);

  return {
    session,
    user: session.user,
    profile: fixedProfile
  };
}

export async function requirePageAccess() {
  return requireAuth();
}

export async function requireAdminPageAccess() {
  const access = await requireAuth();
  if (!access) return null;

  if (!isAdminProfile(access.profile)) {
    window.location.href = './home.html';
    return null;
  }

  return access;
}
