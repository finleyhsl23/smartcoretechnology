import { getSession, getCurrentProfile } from './auth.js';
import { isManagerOrAdmin } from './roles.js';

const LOGIN_PATH = './login.html';
const HOME_PATH = './home.html';

export async function requireAuth() {
  const session = await getSession();

  if (!session) {
    window.location.href = LOGIN_PATH;
    return null;
  }

  const profile = await getCurrentProfile();

  if (!profile) {
    window.location.href = LOGIN_PATH;
    return null;
  }

  return { session, profile };
}

export async function requireGuest() {
  const session = await getSession();

  if (session) {
    window.location.href = HOME_PATH;
    return false;
  }

  return true;
}

export async function requireAdminPageAccess() {
  const auth = await requireAuth();
  if (!auth) return null;

  if (!isManagerOrAdmin(auth.profile)) {
    window.location.href = HOME_PATH;
    return null;
  }

  return auth;
}

export function applyRoleUi(profile) {
  const adminLink = document.getElementById('adminNavLink');
  const adminActionLink = document.getElementById('adminActionLink');

  if (!isManagerOrAdmin(profile)) {
    if (adminLink) adminLink.style.display = 'none';
    if (adminActionLink) adminActionLink.style.display = 'none';
  }
}
