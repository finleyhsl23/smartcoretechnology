// SmartCore Holiday Management — Shared UI Components

// ── SVG Icons ────────────────────────────────────────────────
const Icons = {
  home:       `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/></svg>`,
  calendar:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/></svg>`,
  users:      `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>`,
  leave:      `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z"/></svg>`,
  settings:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>`,
  logout:     `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"/></svg>`,
  switch:     `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"/></svg>`,
  plus:       `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>`,
  check:      `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5"/></svg>`,
  x:          `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg>`,
  info:       `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"/></svg>`,
  warning:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg>`,
  bell:       `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/></svg>`,
  edit:       `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"/></svg>`,
  trash:      `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>`,
  chevron_down: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg>`,
  building:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21"/></svg>`,
  sun:        `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"/></svg>`,
  moon:       `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"/></svg>`,
  cake:       `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 8.25v-1.5M6 10.608v6.384a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6.384"/><path stroke-linecap="round" stroke-linejoin="round" d="M9 8.25V6m0 2.25v-.75m0 .75A.75.75 0 0 1 9.75 9h.75c.414 0 .75.336.75.75v.75m-3 0H6m9-.75v.75M12 6V4.5"/></svg>`,
  star:       `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/></svg>`,
  search:     `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>`,
  eye:        `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>`,
  bug:        `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.7" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 12.75c1.148 0 2.278.08 3.383.237 1.037.146 1.866.966 1.866 2.013 0 3.728-2.35 6.75-5.25 6.75S6.75 18.728 6.75 15c0-1.046.83-1.867 1.866-2.013A24.204 24.204 0 0 1 12 12.75Zm0 0c2.883 0 5.647.508 8.207 1.44a23.91 23.91 0 0 1-1.152 6.06m-15.11-6.06A23.91 23.91 0 0 0 2.793 20.19M12 12.75V3.75m-4.5 4.5L3.75 6.375m16.5 1.875L16.5 8.25"/></svg>`,
};

// ── Toast Notifications ──────────────────────────────────────
function ensureToastContainer() {
  let c = document.getElementById('toast-container');
  if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
  return c;
}

function toast(message, type = 'info', title) {
  const container = ensureToastContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;

  const iconMap = { success: Icons.check, error: Icons.x, warning: Icons.warning, info: Icons.info };
  const titleMap = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Info' };

  el.innerHTML = `
    <div class="toast-icon">${iconMap[type] || Icons.info}</div>
    <div class="flex-col">
      <div class="toast-title">${title || titleMap[type]}</div>
      <div class="toast-msg">${message}</div>
    </div>
    <button class="toast-close" onclick="this.closest('.toast').remove()">${Icons.x}</button>
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hiding');
    setTimeout(() => el.remove(), 220);
  }, 4500);
}

// ── Sidebar Rendering ────────────────────────────────────────
async function renderSidebar(activePage) {
  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;

  const company = getSelectedCompany();
  const role    = getEffectiveRole();
  const isAdm   = isAdmin();
  const isOwn   = isOwner();

  const devMode = isDevModeActive();
  const devRole = devMode ? getDevRole() : null;

  const logoLetter = company?.display_name?.[0] || company?.company_name?.[0] || '?';
  const companyName = company?.display_name || company?.company_name || 'Company';

  // Build nav items based on role
  const commonItems = [
    { href: `${APP_BASE}/app/dashboard.html`,  icon: Icons.home,     label: 'Dashboard',  key: 'dashboard' },
    { href: `${APP_BASE}/app/my-leave.html`,   icon: Icons.leave,    label: 'My Leave',   key: 'my-leave' },
    { href: `${APP_BASE}/app/calendar.html`,   icon: Icons.calendar, label: 'Calendar',   key: 'calendar' },
  ];
  const adminItems = [
    { href: `${APP_BASE}/app/employees.html`,  icon: Icons.users,    label: 'Employees',  key: 'employees' },
    { href: `${APP_BASE}/app/leave-requests.html`, icon: Icons.bell, label: 'Leave Requests', key: 'leave-requests', badge: 'pendingBadge' },
    { href: `${APP_BASE}/app/settings/departments.html`, icon: Icons.settings, label: 'Settings', key: 'settings' },
  ];

  const navItems = isAdm ? [...commonItems, ...adminItems] : commonItems;

  mount.innerHTML = `
    <aside class="sidebar">
      <a class="sidebar-logo" href="${APP_BASE}/app/dashboard.html">
        <div class="sidebar-logo-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:18px;height:18px;color:#fff">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
          </svg>
        </div>
        <div class="sidebar-logo-text">
          <span class="sidebar-logo-title">SmartCore</span>
          <span class="sidebar-logo-sub">Holiday Mgmt</span>
        </div>
      </a>

      <div class="sidebar-company" onclick="switchCompany()" title="Switch Company">
        <div class="company-avatar">
          ${company?.logo_url ? `<img src="${company.logo_url}" alt="">` : logoLetter}
        </div>
        <div class="company-info">
          <div class="company-name">${companyName}</div>
          <div class="company-role">${role || 'employee'}</div>
        </div>
        <div style="color:var(--text-muted);flex-shrink:0">${Icons.switch}</div>
      </div>

      ${devMode ? `<div class="devmode-banner" style="margin:8px;border-radius:var(--radius-sm)">
        ${Icons.bug}
        DEV: ${devRole?.toUpperCase()}
        <button class="btn btn-sm btn-ghost" style="margin-left:auto;padding:2px 6px;font-size:10px" onclick="setDevMode(false);location.reload()">Exit</button>
      </div>` : ''}

      <nav class="sidebar-nav">
        <div class="nav-section">
          ${navItems.map(item => `
            <a href="${item.href}" class="nav-link ${activePage === item.key ? 'active' : ''}">
              ${item.icon}
              ${item.label}
              ${item.badge ? `<span id="${item.badge}" class="nav-badge hidden">0</span>` : ''}
            </a>
          `).join('')}
        </div>
      </nav>

      <div class="sidebar-bottom">
        <button class="nav-link w-full" onclick="toggleTheme()" style="background:none;border:none;text-align:left;cursor:pointer" title="Toggle Theme">
          <span id="theme-toggle-icon" style="width:16px;height:16px;flex-shrink:0;display:flex">${Icons.moon}</span>
        </button>
        ${isOwn ? `<a href="${APP_BASE}/app/settings/departments.html" class="nav-link ${activePage === 'settings' ? 'active' : ''}">${Icons.settings} Settings</a>` : ''}
        <button class="nav-link w-full" onclick="signOut()" style="background:none;border:none;text-align:left;cursor:pointer;color:var(--text-secondary)">
          ${Icons.logout} Sign Out
        </button>
      </div>
    </aside>
  `;

  updateThemeIcon();
}

// ── Confirm Modal ────────────────────────────────────────────
function confirm(title, message, opts = {}) {
  return new Promise(resolve => {
    const id = 'modal-confirm-' + Date.now();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = id;
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px">
        <div class="modal-header">
          <div>
            <div class="modal-title">${title}</div>
            <div class="modal-sub">${message}</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('${id}').remove(); __resolveConfirm_${id.replace(/-/g,'_')}(false)">Cancel</button>
          <button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" onclick="document.getElementById('${id}').remove(); __resolveConfirm_${id.replace(/-/g,'_')}(true)">${opts.confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    `;
    const safeId = id.replace(/-/g, '_');
    window[`__resolveConfirm_${safeId}`] = resolve;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  });
}

// ── Searchable Department Picker ──────────────────────────────
function initDeptPicker(inputId, listId, companyId, currentValue) {
  const input = document.getElementById(inputId);
  const list  = document.getElementById(listId);
  if (!input || !list) return;

  if (currentValue) input.value = currentValue;

  let allDepts = [];

  async function loadDepts() {
    allDepts = await Employees.getDepartments(companyId);
    renderList(input.value);
  }

  function renderList(q) {
    const filtered = allDepts.filter(d => d.toLowerCase().includes(q.toLowerCase()));
    list.innerHTML = '';
    filtered.forEach(d => {
      const item = document.createElement('div');
      item.className = 'dropdown-item';
      item.textContent = d;
      item.addEventListener('mousedown', e => { e.preventDefault(); input.value = d; list.classList.remove('open'); });
      list.appendChild(item);
    });
    const typed = q.trim();
    if (typed && !filtered.includes(typed)) {
      const create = document.createElement('div');
      create.className = 'dropdown-create';
      create.innerHTML = `${Icons.plus} Create "${typed}"`;
      create.addEventListener('mousedown', e => { e.preventDefault(); input.value = typed; list.classList.remove('open'); });
      list.appendChild(create);
    }
    if (list.children.length) list.classList.add('open');
    else list.classList.remove('open');
  }

  input.addEventListener('focus', () => { loadDepts(); });
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('blur', () => setTimeout(() => list.classList.remove('open'), 150));

  loadDepts();
}

// ── Searchable Authoriser Picker ──────────────────────────────
function initAuthoriserPicker(inputId, hiddenId, listId, companyId, createRole, currentEmployee) {
  const input  = document.getElementById(inputId);
  const hidden = document.getElementById(hiddenId);
  const list   = document.getElementById(listId);
  if (!input || !hidden || !list) return;

  let allAdmins = [];

  async function loadAdmins() {
    allAdmins = await Employees.getAdmins(companyId);
    if (currentEmployee?.assigned_authoriser) {
      const found = allAdmins.find(a => a.id === currentEmployee.assigned_authoriser);
      if (found) { input.value = found.full_name; hidden.value = found.id; }
    }
    renderList('');
  }

  function renderList(q) {
    list.innerHTML = '';
    const filtered = allAdmins.filter(a =>
      a.full_name.toLowerCase().includes(q.toLowerCase()) ||
      (a.job_title || '').toLowerCase().includes(q.toLowerCase())
    );
    filtered.forEach(a => {
      const isOwnerRole = a.role === 'owner';
      const isAdminRole = a.role === 'admin';
      const disabled = (createRole === 'admin') && isAdminRole;
      const item = document.createElement('div');
      item.className = `dropdown-item${disabled ? ' disabled' : ''}`;
      item.innerHTML = `
        <div class="avatar avatar-sm" style="background:${avatarBg(a.full_name)};color:#fff">${initials(a.full_name)}</div>
        <div>
          <div style="font-size:12px;font-weight:600">${a.full_name}</div>
          <div style="font-size:10px;color:var(--text-muted)">${a.job_title || ''} · ${a.role}</div>
          ${disabled ? `<div style="font-size:10px;color:var(--danger)">Admins cannot authorise another admin</div>` : ''}
        </div>
      `;
      if (!disabled) {
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          input.value  = a.full_name;
          hidden.value = a.id;
          list.classList.remove('open');
        });
      }
      list.appendChild(item);
    });
    if (list.children.length) list.classList.add('open');
    else list.classList.remove('open');
  }

  input.addEventListener('focus', () => { if (!allAdmins.length) loadAdmins(); else renderList(input.value); list.classList.add('open'); });
  input.addEventListener('input', () => renderList(input.value));
  input.addEventListener('blur',  () => setTimeout(() => list.classList.remove('open'), 150));

  loadAdmins();
}

// ── Page Loading Helper ───────────────────────────────────────
function showPageLoading(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="page-loading"><div class="spinner spinner-lg"></div><div class="text-muted text-sm">Loading...</div></div>`;
}

function hidePageLoading(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '';
}

// ── Entitlement Preview ───────────────────────────────────────
function updateEntitlementPreview(previewId, allowance, startDate, company) {
  const el = document.getElementById(previewId);
  if (!el) return;
  if (!allowance || !startDate) { el.classList.add('hidden'); return; }

  const today = new Date();
  const start = new Date(startDate);
  const ysm = (company?.holiday_year_start_month || 1) - 1;
  const ysd = company?.holiday_year_start_day || 1;
  const yearStart = new Date(today.getFullYear(), ysm, ysd);
  if (yearStart > today) yearStart.setFullYear(yearStart.getFullYear() - 1);
  const yearEnd = new Date(yearStart);
  yearEnd.setFullYear(yearEnd.getFullYear() + 1);

  let display;
  if (start <= yearStart) {
    display = parseFloat(allowance).toFixed(1);
    el.innerHTML = `<span class="value">${display} days</span>Full year — started before ${MONTHS[ysm]} ${ysd}`;
  } else if (start >= yearEnd) {
    el.innerHTML = `<span class="value">0 days</span>Start date is after this leave year ends`;
  } else {
    const remaining = (yearEnd - start) / (yearEnd - yearStart);
    const prorated = roundHalf(allowance * remaining);
    display = prorated.toFixed(1);
    el.innerHTML = `<span class="value">${display} days</span>Prorated from ${formatDate(startDate)} (${(remaining * 100).toFixed(0)}% of year remaining)`;
  }
  el.classList.remove('hidden');
}

// ── Who Else Is Off popup ─────────────────────────────────────
async function showWhoIsOff(companyId, startDate, endDate, excludeEmployeeId) {
  const sb = getSupabase();
  const { data } = await sb.from('leave_requests')
    .select('employees(full_name, job_title, department)')
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .lte('start_date', endDate)
    .gte('end_date', startDate)
    .neq('employee_id', excludeEmployeeId || '');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <div>
          <div class="modal-title">Who Else Is Off</div>
          <div class="modal-sub">${formatDate(startDate)}${startDate !== endDate ? ' – ' + formatDate(endDate) : ''}</div>
        </div>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">${Icons.x}</button>
      </div>
      <div class="modal-body" style="padding:16px">
        ${!data?.length ? '<div class="text-muted text-sm text-center" style="padding:24px">No one else is off during this period.</div>' :
          data.map(r => r.employees).filter(Boolean).map(e => `
            <div class="person-row">
              <div class="avatar avatar-sm" style="background:${avatarBg(e.full_name)};color:#fff">${initials(e.full_name)}</div>
              <div>
                <div class="person-name">${e.full_name}</div>
                <div class="person-sub">${e.job_title || ''}${e.department ? ' · ' + e.department : ''}</div>
              </div>
            </div>`
          ).join('')
        }
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ── Initialise Page ───────────────────────────────────────────
function initPage() {
  initTheme();
  // Inject toast container
  ensureToastContainer();
}

// Call on every page load
document.addEventListener('DOMContentLoaded', initPage);
