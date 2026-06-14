// SmartCore Holiday Management — Auth & Session Management

const SC_COMPANY_KEY  = 'sc_hm_company';
const SC_DEVMODE_KEY  = 'sc_hm_devmode';
const SC_DEVROLE_KEY  = 'sc_hm_devrole';

// ── Session ──────────────────────────────────────────────────
async function getSession() {
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

// ── Page Protection ──────────────────────────────────────────
// Call at top of every protected page
async function requireAuth(redirectTo) {
  const user = await getUser();
  if (!user) {
    const dest = redirectTo || (APP_BASE + '/login.html');
    window.location.href = dest;
    return null;
  }
  return user;
}

// Call at top of every app page (requires both auth + company selection)
async function requireCompany() {
  const user = await requireAuth();
  if (!user) return null;

  const company = getSelectedCompany();
  if (!company) {
    window.location.href = APP_BASE + '/select-company.html';
    return null;
  }
  return { user, company };
}

// ── Company Context ──────────────────────────────────────────
function getSelectedCompany() {
  try {
    const raw = sessionStorage.getItem(SC_COMPANY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setSelectedCompany(companyData) {
  sessionStorage.setItem(SC_COMPANY_KEY, JSON.stringify(companyData));
}

function clearSelectedCompany() {
  sessionStorage.removeItem(SC_COMPANY_KEY);
}

// ── User Memberships ─────────────────────────────────────────
async function getUserMemberships(userId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('company_users')
    .select(`
      id, role, status,
      companies (id, company_name, display_name, logo_url, status)
    `)
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) throw error;
  return data || [];
}

// ── Role Checks ──────────────────────────────────────────────
function getEffectiveRole() {
  if (isDevModeActive()) {
    return getDevRole();
  }
  const company = getSelectedCompany();
  return company?.role ?? null;
}

function isOwner()  { return ['owner'].includes(getEffectiveRole()); }
function isAdmin()  { return ['owner','admin'].includes(getEffectiveRole()); }
function isEmployee(){ return getEffectiveRole() === 'employee'; }

// ── SmartCore Admin Check ────────────────────────────────────
async function isSmartcoreAdmin() {
  const sb = getSupabase();
  // Calls the public schema RPC
  const { data } = await sb.schema('public').rpc('is_smartcore_admin');
  return !!data;
}

// ── Developer Mode ───────────────────────────────────────────
function isDevModeActive() {
  return sessionStorage.getItem(SC_DEVMODE_KEY) === 'true';
}
function getDevRole() {
  return sessionStorage.getItem(SC_DEVROLE_KEY) || 'employee';
}
function setDevMode(active, role) {
  if (active) {
    sessionStorage.setItem(SC_DEVMODE_KEY, 'true');
    sessionStorage.setItem(SC_DEVROLE_KEY, role || 'employee');
  } else {
    sessionStorage.removeItem(SC_DEVMODE_KEY);
    sessionStorage.removeItem(SC_DEVROLE_KEY);
  }
}

// ── Sign Out ─────────────────────────────────────────────────
async function signOut() {
  const sb = getSupabase();
  clearSelectedCompany();
  sessionStorage.removeItem(SC_DEVMODE_KEY);
  sessionStorage.removeItem(SC_DEVROLE_KEY);
  await sb.auth.signOut();
  window.location.href = APP_BASE + '/login.html';
}

// ── Switch Company ───────────────────────────────────────────
function switchCompany() {
  clearSelectedCompany();
  window.location.href = APP_BASE + '/select-company.html';
}

// ── Get current employee record ───────────────────────────────
async function getCurrentEmployee(userId, companyId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('employees')
    .select('*')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .single();
  if (error) return null;
  return data;
}

// ── Theme ────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('sc_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('sc_theme', next);
  updateThemeIcon();
}

function updateThemeIcon() {
  const theme = document.documentElement.getAttribute('data-theme');
  const icon = document.getElementById('theme-toggle-icon');
  if (!icon) return;
  icon.innerHTML = theme === 'dark'
    ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"/></svg>`;
}
