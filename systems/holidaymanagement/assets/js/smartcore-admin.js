import { supabase } from '../../shared/supabase.js';
import { isSmartCoreAdmin, getAllCompanies, createCompany, getEmployeesByCompany } from '../../shared/api.js';
import { revealApp, badgeClass, formatDate, showMessage, setLoadingButton, escapeHtml } from '../../shared/ui.js';

if (localStorage.getItem('holidayTheme') === 'light') document.body.classList.add('light-mode');

let companies = [];

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = '/holidaymanagement/login.html';
    return;
  }

  const isAdmin = await isSmartCoreAdmin(session.user.id);
  if (!isAdmin) {
    document.getElementById('appLoader').innerHTML =
      `<p style="color:#ff9a97;text-align:center;padding:40px">Access denied. SmartCore staff only.</p>`;
    return;
  }

  document.getElementById('adminUserEmail').textContent = session.user.email;

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = '/holidaymanagement/login.html';
  });

  document.getElementById('createCompanyBtn').addEventListener('click', () => openModal('createCompanyModal'));
  document.getElementById('closeCreateCompany').addEventListener('click', () => closeModal('createCompanyModal'));
  document.getElementById('closeCreateCompany2').addEventListener('click', () => closeModal('createCompanyModal'));
  document.getElementById('saveCreateCompany').addEventListener('click', submitCreateCompany);
  document.getElementById('closeCompanyDetail').addEventListener('click', () => closeModal('companyDetailModal'));

  document.getElementById('companySearch').addEventListener('input', () => {
    const q = document.getElementById('companySearch').value.toLowerCase();
    renderList(companies.filter(c => c.name.toLowerCase().includes(q)));
  });

  await loadCompanies();
  revealApp();
}

async function loadCompanies() {
  companies = await getAllCompanies();

  // Tally stats
  document.getElementById('statCompanies').textContent = companies.length;

  let totalEmp = 0, totalInvited = 0;
  for (const c of companies) {
    if (c._employee_count !== undefined) {
      totalEmp += c._employee_count;
    }
  }
  document.getElementById('statEmployees').textContent = '—';
  document.getElementById('statActive').textContent = companies.length;
  document.getElementById('statInvites').textContent = '—';

  renderList(companies);
}

function renderList(items) {
  const list = document.getElementById('companyList');
  if (!items.length) {
    list.innerHTML = `<p class="empty-state muted">No companies found.</p>`;
    return;
  }

  list.innerHTML = items.map(c => {
    const initials = c.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return `
      <div class="leave-card compact" style="cursor:pointer" data-company-id="${c.id}">
        <div class="leave-card-top">
          <div style="display:flex;gap:12px;align-items:center;flex:1">
            <div class="company-select-avatar" style="width:36px;height:36px;border-radius:9px;flex-shrink:0">
              ${c.logo_url ? `<img src="${escapeHtml(c.logo_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:9px" />` : escapeHtml(initials)}
            </div>
            <div class="leave-card-main">
              <p class="leave-card-title">${escapeHtml(c.name)}</p>
              <p class="leave-card-subtitle">${c.contact_email ? escapeHtml(c.contact_email) : 'No contact email'}</p>
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <span class="${badgeClass('active')}">Active</span>
            ${c.default_annual_leave ? `<span class="muted small">${c.default_annual_leave}d default</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-company-id]').forEach(card => {
    card.addEventListener('click', () => {
      const company = companies.find(c => c.id === card.dataset.companyId);
      openCompanyDetail(company);
    });
  });
}

async function openCompanyDetail(company) {
  document.getElementById('detailCompanyName').textContent = company.name;
  document.getElementById('detailCompanySub').textContent = company.contact_email || 'No contact email';

  document.getElementById('companyDetailBody').innerHTML = `<p class="muted">Loading...</p>`;
  openModal('companyDetailModal');

  let employees = [];
  try {
    employees = await getEmployeesByCompany(company.id);
  } catch (e) { /* ignore */ }

  const active = employees.filter(e => e.status === 'active').length;
  const invited = employees.filter(e => e.status === 'invited').length;
  const admins = employees.filter(e => ['admin','owner'].includes(e.role)).length;

  document.getElementById('companyDetailBody').innerHTML = `
    <div class="modal-grid" style="margin-bottom:18px">
      <div class="detail-tile"><span class="detail-label">Company ID</span><span class="detail-value" style="font-size:0.8rem;word-break:break-all">${escapeHtml(company.id)}</span></div>
      <div class="detail-tile"><span class="detail-label">Contact Email</span><span class="detail-value">${escapeHtml(company.contact_email || '—')}</span></div>
      <div class="detail-tile"><span class="detail-label">Default Allowance</span><span class="detail-value">${company.default_annual_leave ?? 28} days</span></div>
      <div class="detail-tile"><span class="detail-label">Total Employees</span><span class="detail-value">${employees.length}</span></div>
      <div class="detail-tile"><span class="detail-label">Active</span><span class="detail-value">${active}</span></div>
      <div class="detail-tile"><span class="detail-label">Pending Invites</span><span class="detail-value">${invited}</span></div>
    </div>

    ${employees.length ? `
      <h3 style="margin:0 0 10px">Employees (${employees.length})</h3>
      ${employees.map(e => `
        <div class="mini-list-row">
          <span>${escapeHtml(e.full_name || e.email || '—')}</span>
          <div style="display:flex;gap:6px">
            <span class="${badgeClass(e.role || 'employee')}">${escapeHtml(e.role || 'employee')}</span>
            <span class="${badgeClass(e.status || 'active')}">${escapeHtml(e.status || 'active')}</span>
          </div>
        </div>
      `).join('')}
    ` : '<p class="muted small">No employees yet.</p>'}
  `;
}

async function submitCreateCompany() {
  const btn = document.getElementById('saveCreateCompany');
  const name = document.getElementById('newCompanyName').value.trim();
  const ownerName = document.getElementById('newOwnerName').value.trim();
  const ownerEmail = document.getElementById('newOwnerEmail').value.trim();
  const allowance = parseInt(document.getElementById('newAllowance').value) || 28;

  if (!name || !ownerEmail) {
    showMessage('createCompanyMsg', 'Company name and owner email are required.', 'error');
    return;
  }

  setLoadingButton(btn, true, 'Creating...');
  showMessage('createCompanyMsg', '', 'info');

  try {
    const company = await createCompany({ name, default_annual_leave: allowance });

    // Send owner invite
    await fetch('/holidaymanagement/send-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: company.id,
        company_name: name,
        invite_type: 'owner',
        full_name: ownerName,
        email: ownerEmail,
        role: 'owner',
        annual_leave_allowance: allowance
      })
    });

    closeModal('createCompanyModal');
    document.getElementById('newCompanyName').value = '';
    document.getElementById('newOwnerName').value = '';
    document.getElementById('newOwnerEmail').value = '';
    await loadCompanies();
  } catch (err) {
    showMessage('createCompanyMsg', err.message, 'error');
  } finally {
    setLoadingButton(btn, false);
  }
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

init();
