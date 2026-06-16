import { supabase } from '../../shared/supabase.js';
import { getCompaniesForUser } from '../../shared/api.js';
import { setSelectedCompany } from '../../shared/guards.js';
import { revealApp, showMessage, escapeHtml } from '../../shared/ui.js';

if (localStorage.getItem('holidayTheme') === 'light') {
  document.body.classList.add('light-mode');
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = '/systems/holidaymanagement/login.html';
});

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/systems/holidaymanagement/login.html';
    return;
  }

  let companies;
  try {
    companies = await getCompaniesForUser(session.user.id);
  } catch (err) {
    showMessage('companyMsg', 'Failed to load companies: ' + err.message, 'error');
    revealApp();
    return;
  }

  if (companies.length === 0) {
    showMessage('companyMsg', 'You are not a member of any company. Check your invite email.', 'info');
    revealApp();
    return;
  }

  // Auto-select if only one company
  if (companies.length === 1) {
    selectCompany(companies[0]);
    return;
  }

  renderList(companies);
  revealApp();
}

function renderList(companies) {
  const list = document.getElementById('companyList');
  list.innerHTML = companies.map(c => {
    const initials = c.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return `
      <button class="company-select-card" data-id="${escapeHtml(c.id)}">
        <div class="company-select-avatar">
          ${c.logo_url
            ? `<img src="${escapeHtml(c.logo_url)}" alt="${escapeHtml(c.name)}" />`
            : escapeHtml(initials)}
        </div>
        <div>
          <div class="company-select-name">${escapeHtml(c.name)}</div>
          <div class="company-select-role">${escapeHtml(c.role || 'Employee')}</div>
        </div>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.company-select-card').forEach((btn, i) => {
    btn.addEventListener('click', () => selectCompany(companies[i]));
  });
}

function selectCompany(company) {
  setSelectedCompany({
    id: company.id,
    name: company.name,
    logo_url: company.logo_url || null,
    role: company.role,
    is_admin: company.is_admin,
    employee_id: company.employee_id
  });
  window.location.href = '/systems/holidaymanagement/home.html';
}

init();
