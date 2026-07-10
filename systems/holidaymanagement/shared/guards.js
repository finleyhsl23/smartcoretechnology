import { supabase, db } from './supabase.js';

const THEME_KEY = 'holidayTheme';
const COMPANY_KEY = 'sc_hm_company';

export function getSelectedCompany() {
  try {
    const raw = sessionStorage.getItem(COMPANY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function setSelectedCompany(data) {
  sessionStorage.setItem(COMPANY_KEY, JSON.stringify(data));
}

export function clearSelectedCompany() {
  sessionStorage.removeItem(COMPANY_KEY);
}

export function isAdminProfile(profile) {
  return profile?.is_admin === true || ['admin', 'owner'].includes(String(profile?.role || '').toLowerCase());
}

export function applyRoleUi(profile) {
  const isAdmin = isAdminProfile(profile);
  document.querySelectorAll('.admin-only-link').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
}

// Auto-detect the user's company via company_users (RLS allows user_id = auth.uid() SELECT)
async function autoDetectCompany(userId) {
  const { data: cu } = await db
    .from('company_users')
    .select('company_id, employee_id, role, status')
    .eq('user_id', userId)
    .in('status', ['active', 'invited'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cu) return null;

  const { data: company } = await db
    .from('companies')
    .select('id, company_name, logo_url')
    .eq('id', cu.company_id)
    .maybeSingle();

  if (!company) return null;

  const { data: emp } = await db
    .from('employees')
    .select('id, role, is_admin')
    .eq('id', cu.employee_id)
    .maybeSingle();

  return {
    id: company.id,
    name: company.company_name,
    logo_url: company.logo_url || null,
    role: emp?.role || cu.role,
    is_admin: emp?.is_admin || false,
    employee_id: cu.employee_id
  };
}

const MOON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="18" height="18"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/></svg>`;
const SUN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="5"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;

function setupThemeToggle() {
  if (localStorage.getItem(THEME_KEY) === 'light') document.body.classList.add('light-mode');
  const btn = document.getElementById('themeToggleBtn');
  function updateBtn() {
    if (!btn) return;
    const isLight = document.body.classList.contains('light-mode');
    btn.innerHTML = isLight ? MOON_SVG : SUN_SVG;
    btn.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
  }
  updateBtn();
  if (btn) {
    btn.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light-mode');
      localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
      updateBtn();
    });
  }
}

export async function requireAuth(opts = {}) {
  const { adminOnly = false } = opts;

  if (localStorage.getItem(THEME_KEY) === 'light') document.body.classList.add('light-mode');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/modules/';
    return null;
  }

  // Use cached company, or auto-detect from DB
  let company = getSelectedCompany();
  if (!company) {
    company = await autoDetectCompany(session.user.id);
    if (company) setSelectedCompany(company);
  }

  if (!company) {
    const loader = document.getElementById('appLoader');
    if (loader) loader.textContent = 'No company found. Please contact your administrator or check your invite email.';
    return null;
  }

  // Always load fresh profile from DB — query by employee_id (RLS allows members to read their company's employees)
  const { data: profile } = await db
    .from('employees')
    .select('*')
    .eq('id', company.employee_id)
    .maybeSingle();

  // Sync role/is_admin from live profile back onto the cached company object
  if (profile) {
    company.role = profile.role;
    company.is_admin = profile.is_admin;
    company.employee_id = profile.id;
    setSelectedCompany(company);
  }

  if (adminOnly && !isAdminProfile(profile)) {
    window.location.href = '/systems/holidaymanagement/home.html';
    return null;
  }

  applyRoleUi(profile);
  setupThemeToggle();
  setupLogout();

  return { session, profile, company };
}

export async function requireAdminPageAccess() {
  return requireAuth({ adminOnly: true });
}

function setupLogout() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    clearSelectedCompany();
    await supabase.auth.signOut();
    window.location.href = '/modules/';
  });
}
