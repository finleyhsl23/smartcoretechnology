import { supabase, leaveSchema } from './supabase.js';

export async function getSessionOrRedirect() {
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    window.location.href = './login.html';
    return null;
  }

  return data.session;
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

export async function requirePageAccess() {
  const session = await getSessionOrRedirect();
  if (!session) return null;

  const profile = await getCurrentProfile();

  return {
    session,
    user: session.user,
    profile
  };
}

export async function requireAdminPageAccess() {
  const access = await requirePageAccess();
  if (!access) return null;

  const isAdmin =
    access.profile.is_admin === true ||
    ['admin', 'owner'].includes(String(access.profile.role || '').toLowerCase());

  if (!isAdmin) {
    window.location.href = './home.html';
    return null;
  }

  return access;
}
