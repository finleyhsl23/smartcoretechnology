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
  return profile?.is_admin === true || ['admin','owner'].includes(String(profile?.role || '').toLowerCase());
}

export function applyRoleUi(profile) {
  const isAdmin = isAdminProfile(profile);
  document.querySelectorAll('.admin-only-link').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
}

function setupThemeToggle() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light') document.body.classList.add('light-mode');

  const btn = document.createElement('button');
  btn.className = 'btn btn-white theme-toggle-btn';
  btn.id = 'themeToggleBtn';
  btn.textContent = document.body.classList.contains('light-mode') ? '🌙 Dark' : '☀️ Light';
  btn.addEventListener('click', () => {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
    btn.textContent = isLight ? '🌙 Dark' : '☀️ Light';
  });
  document.body.appendChild(btn);
}

export async function requireAuth(opts = {}) {
  const { adminOnly = false, requireCompany = true } = opts;

  // Apply theme immediately to avoid flash
  if (localStorage.getItem(THEME_KEY) === 'light') {
    document.body.classList.add('light-mode');
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/systems/holidaymanagement/login.html';
    return null;
  }

  // Company selection check
  const company = getSelectedCompany();
  if (requireCompany && !company) {
    window.location.href = '/systems/holidaymanagement/select-company.html';
    return null;
  }

  // Load profile from DB
  let profile = null;
  if (company) {
    const { data } = await db
      .from('employees')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('company_id', company.id)
      .single();
    profile = data;
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
    window.location.href = '/systems/holidaymanagement/login.html';
  });
}
